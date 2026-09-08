'use strict';

/**
 * databricks-cancel-reader.js
 *
 * Queries the Databricks Serve layer for booking details belonging to
 * a given list of PO numbers.  The result is shaped into rows that
 * vbkreq-cancel-builder.js can consume directly to produce VBKREQ XML
 * with purposeCd = '01' (cancellation).
 *
 * Tables used:
 *   sourcingandbuying.serve.fact_purchase_order_commitment_v1
 *   supplychain.serve.dim_advanced_shipment_notice_v1
 *   sourcingandbuying.serve.dim_purchase_order_v1
 *   sourcingandbuying.serve.dim_supplier_v1
 *   sourcingandbuying.serve.dim_factory_v1
 */

const db = require('./databricks-client');

/** Normalise a raw date value to YYYY-MM-DD; strips 1900-01-01 sentinel. */
function toDateStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (s === '1900-01-01') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s === '1900-01-01' ? '' : s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const iso = d.toISOString().slice(0, 10);
  return iso === '1900-01-01' ? '' : iso;
}

/** Map freight forwarder service description → E2open transport mode code. */
function resolveTransportMode(freightService) {
  const s = String(freightService || '').toLowerCase();
  if (!s || s === 'unknown') return '30';
  if (/\bair\b/.test(s))                     return '40';
  if (/sea|ocean|fcl|lcl|maritime/.test(s))   return '10';
  if (/rail/.test(s))                         return '50';
  return '30'; // road/truck default for UK/EU nominated carriers
}

/**
 * Fetch booking data from Databricks for the given PO reference numbers.
 *
 * Returns:
 *   { bookingRows: Array<object>, errors: string[] }
 *
 * Each bookingRow contains all fields needed by vbkreq-cancel-builder to
 * produce a cancellation VBKREQ, keyed as vbkreq-builder expects them.
 */
async function fetchCancelDataByPoRefs(poRefs) {
  if (!poRefs || poRefs.length === 0) {
    return { bookingRows: [], errors: ['No PO references provided'] };
  }

  const safePOs = poRefs
    .map(p => String(p).trim())
    .filter(p => /^\d+$/.test(p));

  if (safePOs.length === 0) {
    return { bookingRows: [], errors: ['No valid numeric PO references provided'] };
  }

  console.log(`[Databricks Cancel] querying ${safePOs.length} PO(s): ${safePOs.join(', ')}`);

  const poList = safePOs.map(p => `'${p}'`).join(', ');

  // Star-schema query — QUALIFY picks the latest daily snapshot per PO + ASN + SKU.
  const sql = `
    WITH latest_facts AS (
      SELECT
        f.dim_purchase_order_sk                                                    AS poId,
        f.dim_advanced_shipment_notice_sk                                          AS asnId,
        f.dim_product_sk                                                           AS sku,
        CAST(f.dim_first_warehouse_sk AS STRING)                                   AS firstDestination,
        CAST(f.dim_final_warehouse_sk AS STRING)                                   AS finalDestination,
        f.is_booked_by_carrier,
        f.quantity                                                                 AS bookedQty,
        f.dim_purchase_order_shipping_method_sk                                    AS shippingMethod,
        CAST(f.dim_expected_factory_date_sk                                AS STRING) AS exFactoryDate,
        CAST(f.dim_expected_shipment_date_sk                               AS STRING) AS expectedShipmentDate,
        CAST(f.dim_first_warehouse_current_expected_delivery_date_sk       AS STRING) AS expectedDeliveryDate,
        f.dim_factory_sk,
        f.dim_supplier_sk,
        -- 1 if any SKU row in this ASN has been booked; used to filter out unbooked ASNs
        MAX(CASE WHEN f.is_booked_by_carrier = 'Yes' THEN 1 ELSE 0 END) OVER (
          PARTITION BY f.dim_advanced_shipment_notice_sk
        )                                                                          AS asnIsBooked
      FROM sourcingandbuying.serve.fact_purchase_order_commitment_v1 f
      WHERE f.dim_purchase_order_sk IN (${poList})
        AND f.dim_advanced_shipment_notice_sk != 'Unknown'
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY f.dim_purchase_order_sk, f.dim_advanced_shipment_notice_sk, f.dim_product_sk
        ORDER BY f.dim_date_sk DESC
      ) = 1
    )
    SELECT
      lf.poId,
      lf.asnId,
      lf.sku,
      lf.firstDestination,
      lf.finalDestination,
      lf.is_booked_by_carrier    AS isBookedByCarrier,
      lf.bookedQty,
      lf.shippingMethod,
      lf.exFactoryDate,
      lf.expectedShipmentDate,
      lf.expectedDeliveryDate,
      lf.asnIsBooked,
      asn.asn_id,
      asn.asn_status_code,
      asn.carrier_code,
      asn.lading_port_code,
      cb.inbound_carrier_booking_reference  AS vbBookingRef,
      sup.supplier_id,
      sup.supplier               AS supplierName,
      sup.primary_country_code   AS supplierCountry,
      fac.factory_code           AS factoryID,
      fac.factory                AS factoryName,
      fac.factory_country_code,
      po.inco_terms,
      po.purchase_order_freight_forwarder_service  AS freightService,
      DATE_FORMAT(po.dim_original_purchase_order_shipment_date_sk,           'yyyy-MM-dd') AS poShipDate,
      DATE_FORMAT(po.dim_current_requested_intake_first_destination_date_sk, 'yyyy-MM-dd') AS poDeliveryDate
    FROM latest_facts lf
    LEFT JOIN supplychain.serve.dim_advanced_shipment_notice_v1 asn
           ON lf.asnId = asn.dim_advanced_shipment_notice_sk
    LEFT JOIN sourcingandbuying.serve.dim_supplier_v1 sup
           ON lf.dim_supplier_sk = sup.dim_supplier_sk
    LEFT JOIN sourcingandbuying.serve.dim_factory_v1 fac
           ON lf.dim_factory_sk = fac.dim_factory_sk
    LEFT JOIN sourcingandbuying.serve.dim_purchase_order_v1 po
           ON lf.poId = po.dim_purchase_order_sk
    LEFT JOIN supplychain.serve.fact_carrier_bookings_v1 cbf
           ON cbf.asn_id = asn.asn_id
    LEFT JOIN supplychain.serve.dim_carrier_booking_v1 cb
           ON cb.dim_carrier_booking_sk = cbf.dim_carrier_booking_sk
    WHERE asn.asn_id IS NOT NULL
      AND (asn.asn_status_code IS NULL OR asn.asn_status_code != 'D')
    -- deduplicate: one row per ASN/SKU using the latest snapshot; booking state is no longer a gate
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY lf.asnId, lf.poId, lf.sku
      ORDER BY cbf.dim_supplier_booked_date_sk DESC NULLS LAST
    ) = 1
    ORDER BY lf.asnId, lf.poId, lf.sku
  `;

  let rows;
  try {
    rows = await db.query(sql);
    console.log(`[Databricks Cancel] ${(rows || []).length} row(s) returned`);
  } catch (err) {
    return { bookingRows: [], errors: [`Databricks query failed: ${err.message}`] };
  }

  if (!rows || rows.length === 0) {
    const missing = safePOs.map(p => `No PO/ASN/SKU rows found for PO ${p}`);
    return { bookingRows: [], errors: missing };
  }

  // Group rows by ASN so one VBKREQ is generated per ASN.
  const asnMap = {};
  for (const row of rows) {
    const asnKey = String(row.asn_id || row.asnId || '');
    if (!asnMap[asnKey]) {
      asnMap[asnKey] = {
        // vbkreq-builder field names
        ASN_Ref:                   asnKey,
        PO_Number:                 String(row.poId     || ''),
        FC_ID:                     String(row.firstDestination || 'FC01'),
        Supplier_Name:             row.supplierName    || '',
        Supplier_ID:               row.supplier_id     || '',
        Supplier_CountryCd:        row.supplierCountry || '',
        Factory_ID:                row.factoryID       || '',
        Factory_Name:              row.factoryName     || '',
        Factory_CountryCd:         row.factory_country_code || '',
        Loading_Port_LOCODE:       row.lading_port_code || '',
        // shippingMethod is the E2open mode code (10/30/40) stored directly on the fact
        Mode_Of_Transport:         row.shippingMethod  || '30',
        Carrier_ID:                row.carrier_code    || '3',
        Ship_Date:                 toDateStr(row.poShipDate || row.expectedShipmentDate),
        Expected_Delivery_Date:    toDateStr(row.poDeliveryDate || row.expectedDeliveryDate),
        // Booking quantities (aggregate over lines below)
        Booking_Qty:               0,
        Header_Booking_Qty:        0,
        No_of_Cartons:             0,
        Unit_Weight_KG:            0,
        // Cancellation-specific defaults
        Traffic_Mode:              'CFS',
        Country_Of_Origin:         row.factory_country_code || 'XX',
        Hazardous:                 null,
        Collection_Type:           'Delivery',
        Remarks:                   '',
        Cargo_Ready_Planned_Collection_Date: '',
        Carrier_Booking_Request_Date:        '',
        ASN_Delivery_Date:         toDateStr(row.poDeliveryDate || row.expectedDeliveryDate),
        // Use the accepted default VB booking ref when no valid ref is available.
        Booking_Ref: (row.vbBookingRef && row.vbBookingRef !== 'Unknown')
                       ? row.vbBookingRef
                       : 'VB-1000000206',
        _skuLines: [],
      };
    }
    const entry = asnMap[asnKey];
    entry.Booking_Qty        += parseFloat(row.bookedQty || 0);
    entry.Header_Booking_Qty += parseFloat(row.bookedQty || 0);
    entry._skuLines.push({
      sku:    String(row.sku       || ''),
      qty:    parseFloat(row.bookedQty || 0),
      poId:   String(row.poId     || ''),
      asnId:  asnKey,
      fcId:   String(row.firstDestination || 'FC01'),
    });
  }

  const bookingRows = Object.values(asnMap);
  console.log(`[Databricks Cancel] grouped into ${bookingRows.length} ASN booking(s)`);

  return { bookingRows, errors: [] };
}

async function fetchCancelDataByAsnRefs(asnRefs) {
  if (!asnRefs || asnRefs.length === 0) {
    return { bookingRows: [], errors: ['No ASN references provided'] };
  }

  const safeASNs = asnRefs
    .map(a => String(a).trim())
    .filter(a => a && a !== 'Unknown');

  if (safeASNs.length === 0) {
    return { bookingRows: [], errors: ['No valid ASN references provided'] };
  }

  console.log(`[Databricks Cancel] querying ${safeASNs.length} ASN(s): ${safeASNs.join(', ')}`);

  const asnList = safeASNs.map(a => `'${String(a).replace(/'/g, "''")}'`).join(', ');

  const sql = `
    WITH latest_facts AS (
      SELECT
        f.dim_purchase_order_sk                                                    AS poId,
        f.dim_advanced_shipment_notice_sk                                          AS asnId,
        f.dim_product_sk                                                           AS sku,
        CAST(f.dim_first_warehouse_sk AS STRING)                                   AS firstDestination,
        CAST(f.dim_final_warehouse_sk AS STRING)                                   AS finalDestination,
        f.is_booked_by_carrier,
        f.quantity                                                                 AS bookedQty,
        f.dim_purchase_order_shipping_method_sk                                    AS shippingMethod,
        CAST(f.dim_expected_factory_date_sk                                AS STRING) AS exFactoryDate,
        CAST(f.dim_expected_shipment_date_sk                               AS STRING) AS expectedShipmentDate,
        CAST(f.dim_first_warehouse_current_expected_delivery_date_sk       AS STRING) AS expectedDeliveryDate,
        f.dim_factory_sk,
        f.dim_supplier_sk,
        MAX(CASE WHEN f.is_booked_by_carrier = 'Yes' THEN 1 ELSE 0 END) OVER (
          PARTITION BY f.dim_advanced_shipment_notice_sk
        )                                                                          AS asnIsBooked
      FROM sourcingandbuying.serve.fact_purchase_order_commitment_v1 f
      INNER JOIN supplychain.serve.dim_advanced_shipment_notice_v1 asn
        ON f.dim_advanced_shipment_notice_sk = asn.dim_advanced_shipment_notice_sk
      WHERE asn.asn_id IN (${asnList})
        AND f.dim_advanced_shipment_notice_sk != 'Unknown'
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY f.dim_purchase_order_sk, f.dim_advanced_shipment_notice_sk, f.dim_product_sk
        ORDER BY f.dim_date_sk DESC
      ) = 1
    )
    SELECT
      lf.poId,
      lf.asnId,
      lf.sku,
      lf.firstDestination,
      lf.finalDestination,
      lf.is_booked_by_carrier    AS isBookedByCarrier,
      lf.bookedQty,
      lf.shippingMethod,
      lf.exFactoryDate,
      lf.expectedShipmentDate,
      lf.expectedDeliveryDate,
      lf.asnIsBooked,
      asn.asn_id,
      asn.asn_status_code,
      asn.carrier_code,
      asn.lading_port_code,
      cb.inbound_carrier_booking_reference  AS vbBookingRef,
      sup.supplier_id,
      sup.supplier               AS supplierName,
      sup.primary_country_code   AS supplierCountry,
      fac.factory_code           AS factoryID,
      fac.factory                AS factoryName,
      fac.factory_country_code,
      po.inco_terms,
      po.purchase_order_freight_forwarder_service  AS freightService,
      DATE_FORMAT(po.dim_original_purchase_order_shipment_date_sk,           'yyyy-MM-dd') AS poShipDate,
      DATE_FORMAT(po.dim_current_requested_intake_first_destination_date_sk, 'yyyy-MM-dd') AS poDeliveryDate
    FROM latest_facts lf
    LEFT JOIN supplychain.serve.dim_advanced_shipment_notice_v1 asn
           ON lf.asnId = asn.dim_advanced_shipment_notice_sk
    LEFT JOIN sourcingandbuying.serve.dim_supplier_v1 sup
           ON lf.dim_supplier_sk = sup.dim_supplier_sk
    LEFT JOIN sourcingandbuying.serve.dim_factory_v1 fac
           ON lf.dim_factory_sk = fac.dim_factory_sk
    LEFT JOIN sourcingandbuying.serve.dim_purchase_order_v1 po
           ON lf.poId = po.dim_purchase_order_sk
    LEFT JOIN supplychain.serve.fact_carrier_bookings_v1 cbf
           ON cbf.asn_id = asn.asn_id
    LEFT JOIN supplychain.serve.dim_carrier_booking_v1 cb
           ON cb.dim_carrier_booking_sk = cbf.dim_carrier_booking_sk
    WHERE asn.asn_id IS NOT NULL
      AND (asn.asn_status_code IS NULL OR asn.asn_status_code != 'D')
      AND lf.asnIsBooked = 1
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY lf.asnId, lf.poId, lf.sku
      ORDER BY cbf.dim_supplier_booked_date_sk DESC NULLS LAST
    ) = 1
    ORDER BY lf.asnId, lf.poId, lf.sku
  `;

  let rows;
  try {
    rows = await db.query(sql);
    console.log(`[Databricks Cancel] ${(rows || []).length} row(s) returned`);
  } catch (err) {
    return { bookingRows: [], errors: [`Databricks query failed: ${err.message}`] };
  }

  if (!rows || rows.length === 0) {
    const missing = safeASNs.map(a => `No active booked ASN found for ASN ${a}`);
    return { bookingRows: [], errors: missing };
  }

  return groupBookingRows(rows);
}

async function fetchCancelDataByRefs({ poRefs, asnRefs } = {}) {
  if (asnRefs && asnRefs.length) {
    return fetchCancelDataByAsnRefs(asnRefs);
  }
  return fetchCancelDataByPoRefs(poRefs || []);
}

module.exports = { fetchCancelDataByPoRefs, fetchCancelDataByAsnRefs, fetchCancelDataByRefs };
