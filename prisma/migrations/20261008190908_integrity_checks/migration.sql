-- Database-level guarantees that back up the service-layer business rules.

-- Damaged stock can never be negative (sellable stock may go negative only
-- when the "allow negative stock" setting is enabled, enforced in the service).
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_damaged_nonneg" CHECK ("damaged" >= 0);

-- Document lines always carry positive quantities and non-negative money.
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_price_nonneg" CHECK ("unitPrice" >= 0 AND "discount" >= 0 AND "lineTotal" >= 0);
-- A sale line can never be returned more than it was sold.
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_returned_range" CHECK ("returnedQty" >= 0 AND "returnedQty" <= "quantity");
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_refund_range" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "netAmount");

ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_rate_nonneg" CHECK ("rate" >= 0 AND "discount" >= 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_returned_range" CHECK ("returnedQty" >= 0 AND "returnedQty" <= "quantity");

ALTER TABLE "CustomerReturnItem" ADD CONSTRAINT "CustomerReturnItem_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_qty_range" CHECK ("requiredQty" > 0 AND "scannedQty" >= 0);
ALTER TABLE "BillOfMaterial" ADD CONSTRAINT "BillOfMaterial_output_pos" CHECK ("outputQty" > 0);
ALTER TABLE "BillOfMaterialItem" ADD CONSTRAINT "BillOfMaterialItem_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "Production" ADD CONSTRAINT "Production_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "ProductionItem" ADD CONSTRAINT "ProductionItem_qty_pos" CHECK ("quantity" > 0);

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_prices_nonneg" CHECK ("purchasePrice" >= 0 AND "sellingPrice" >= 0 AND "minStock" >= 0 AND "reorderLevel" >= 0);

-- Ledger rows are never zero-quantity.
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_qty_nonzero" CHECK ("quantity" <> 0);

-- Sale/purchase money sanity.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_money_nonneg" CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total" AND "refundedAmount" >= 0);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_money_nonneg" CHECK ("total" >= 0 AND "amountPaid" >= 0);

-- Case-insensitive lookups for barcode scanning by SKU.
CREATE INDEX "ProductVariant_sku_lower_idx" ON "ProductVariant" (lower("sku"));
