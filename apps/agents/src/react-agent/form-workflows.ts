type FormWorkflowEntry = {
  match: string | RegExp;
  label: string;
  guidance: string;
};

const FORM_WORKFLOWS: FormWorkflowEntry[] = [
  {
    match: /^stock[_-]entry[_-]create$/,
    label: "Stock Entry",
    guidance: [
      "WORKFLOW for Stock Entry:",
      "1. Set entry_type FIRST (RECEIPT, ISSUE, TRANSFER, etc.) — this controls which location fields appear.",
      "2. Set source_location / destination_location based on entry_type. Wait for page refresh.",
      "3. For each item row: set the `item` field FIRST and wait for the page to refresh.",
      "4. ONLY AFTER the item is set and the page refreshes, `instances` and `batch` fields become visible (they depend on item).",
      "5. Fill quantity, unit_price, and other row fields.",
      "CRITICAL: never attempt to set or search instances/batch before the row's item is resolved — they will not exist in the field schema yet.",
    ].join("\n"),
  },
  {
    match: /^inspection[_-]create$/,
    label: "Inspection Create",
    guidance: [
      "WORKFLOW for Inspection Create:",
      "1. Set department (required foreign key — use search_form_options if not in visible options).",
      "2. Set contract_no, indent_no, contractor_name, date_of_inspection.",
      "3. Add item rows: each row needs item_description, tendered_quantity, accepted_quantity, rejected_quantity, unit_price.",
      "4. Fill all required fields for a row in one set_form_values call when possible.",
      "5. Submit creates the inspection and returns a recordId. To continue to the next stage, navigate to /inspections/{recordId}.",
    ].join("\n"),
  },
  {
    match: /central[_-]register$/,
    label: "Inspection — Central Register",
    guidance: [
      "WORKFLOW for Central Register stage:",
      "1. For each item row, fill these together: central_register (stock register ID), central_register_page_no, and item (inventory item foreign key).",
      "2. Use search_form_options to find the correct stock register and item if not in visible options.",
      "3. If search_form_options cannot resolve a row's item, do NOT create a new item yourself. List the available item options with an empty query and compare them by description and specifications, not just by name — similar names can be different products, and a match may already exist under a slightly different name. Link an existing item when it genuinely matches. If none matches, STOP and ask the user: show the inspected item with its description, the closest existing catalog items, and your reasoning for why it looks new, then ask whether to link an existing item or create a new one. Open item_create only after the user explicitly confirms — never auto-create items, it produces duplicate catalog data.",
      "4. After linking all items, submit to advance to the next stage.",
    ].join("\n"),
  },
  {
    match: /stock[_-]details$/,
    label: "Inspection — Stock Details",
    guidance: [
      "WORKFLOW for Stock Details stage:",
      "1. For each item row, fill these together: stock_register (stock register ID), stock_register_page_no, stock_entry_date.",
      "2. Use search_form_options to resolve stock_register if not in visible options.",
      "3. Submit to advance to the next stage.",
    ].join("\n"),
  },
  {
    match: /finance[_-]review$/,
    label: "Inspection — Finance Review",
    guidance: [
      "WORKFLOW for Finance Review stage:",
      "1. Review item rows and fill depreciation_asset_class and any other finance-specific fields.",
      "2. Use search_form_options to resolve depreciation_asset_class if needed.",
      "3. Submit to advance to the next stage.",
    ].join("\n"),
  },
  {
    match: /final[_-]approval$/,
    label: "Inspection — Final Approval",
    guidance: [
      "WORKFLOW for Final Approval stage:",
      "1. Review all item rows and previous stage data.",
      "2. Submit to complete the inspection workflow.",
    ].join("\n"),
  },
  {
    match: /^item[_-]create$/,
    label: "Item Create",
    guidance: [
      "WORKFLOW for Item Create:",
      "1. Set category FIRST (required — affects available subcategories and field visibility).",
      "2. Set name and code (both required).",
      "3. Set tracking_type (INDIVIDUAL or QUANTITY).",
      "4. Fill remaining fields: unit_of_measurement, description, etc.",
    ].join("\n"),
  },
  {
    match: /^category[_-]create$/,
    label: "Category Create",
    guidance: [
      "WORKFLOW for Category Create:",
      "1. Set name (required).",
      "2. Set category_type (FIXED_ASSET, CONSUMABLE, or PERISHABLE).",
      "3. Set tracking_type (INDIVIDUAL or QUANTITY).",
    ].join("\n"),
  },
  {
    match: /^subcategory[_-]create$/,
    label: "Subcategory Create",
    guidance: [
      "WORKFLOW for Subcategory Create:",
      "1. The parent category is determined by the current detail page — do not try to set it.",
      "2. Set name (required).",
      "3. Set category_type and tracking_type if they differ from the parent.",
    ].join("\n"),
  },
  {
    match: /^location[_-]create$/,
    label: "Location Create",
    guidance: [
      "WORKFLOW for Location Create:",
      "1. Set name (required).",
      "2. Set location_type.",
      "3. Set is_store if this location is a store.",
    ].join("\n"),
  },
  {
    match: /^sublocation[_-]create$/,
    label: "Sublocation Create",
    guidance: [
      "WORKFLOW for Sublocation Create:",
      "1. The parent location is determined by the current detail page — do not try to set it.",
      "2. Set name (required).",
      "3. Set location_type and is_store as needed.",
    ].join("\n"),
  },
  {
    match: /^stock[_-]register[_-]create$/,
    label: "Stock Register Create",
    guidance: [
      "WORKFLOW for Stock Register Create:",
      "1. Set location (required foreign key — use search_form_options if needed).",
      "2. Set register_number or leave blank for auto-generation.",
    ].join("\n"),
  },
];

export function getFormWorkflowGuidance(formId: string): string | null {
  for (const entry of FORM_WORKFLOWS) {
    if (typeof entry.match === "string") {
      if (entry.match === formId) return entry.guidance;
    } else {
      if (entry.match.test(formId)) return entry.guidance;
    }
  }
  return null;
}
