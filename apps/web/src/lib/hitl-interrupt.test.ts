import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHitlResume,
  buildHitlReviewModel,
  getHitlActionReviewCopy,
  isHitlInterruptSchema,
  type HitlRequest,
} from "./hitl-interrupt";

const request: HitlRequest = {
  actionRequests: [
    {
      name: "request_form_submit",
      args: { formId: "category-form", intent: "save" },
      description: "Approve submitting the active AMS form?",
    },
  ],
  reviewConfigs: [
    {
      actionName: "request_form_submit",
      allowedDecisions: ["approve", "reject"],
    },
  ],
};

test("detects LangChain HITL interrupt requests", () => {
  assert.equal(isHitlInterruptSchema(request), true);
  assert.equal(isHitlInterruptSchema({ action_request: {}, config: {} }), false);
});

test("builds approve and reject resume payloads for HITL requests", () => {
  assert.deepEqual(buildHitlResume(request, "approve"), {
    decisions: [{ type: "approve" }],
  });
  assert.deepEqual(buildHitlResume(request, "reject"), {
    decisions: [
      {
        type: "reject",
        message: "User rejected request_form_submit. Do not submit the form.",
      },
    ],
  });
});

test("builds structured auto-rejection resume payloads for moot HITL requests", () => {
  const resume = buildHitlResume(
    request,
    "reject",
    "user_submitted_manually",
  );

  assert.equal(resume.decisions[0].type, "reject");
  assert.match(resume.decisions[0].message ?? "", /already submitted/i);
  assert.match(resume.decisions[0].message ?? "", /reason=user_submitted_manually/);
  assert.match(resume.decisions[0].message ?? "", /Do not retry/i);
});

test("builds production review copy for AMS form submit approval", () => {
  const copy = getHitlActionReviewCopy({
    name: "request_form_submit",
    args: { formId: "inspection_detail_42_stock_details", intent: "submit" },
    description: "Approve submitting the active AMS form?",
  });

  assert.equal(copy.title, "Submit active AMS form");
  assert.match(copy.description, /runs against the form currently open/i);
  assert.deepEqual(copy.details, [
    "Form: inspection_detail_42_stock_details",
  ]);
});

test("builds a detailed inspection approval model", () => {
  const model = buildHitlReviewModel({
    name: "request_form_submit",
    args: { formId: "inspection_detail_42_stage4", intent: "submit" },
    description: "Move CTR-2026-001 to final approval",
  });

  assert.equal(model.title, "Submit inspection certificate");
  assert.equal(model.intentLabel, "Submit");
  assert.equal(model.recordLabel, "inspection_detail_42_stage4");
  assert.equal(model.riskLevel, "High");
  assert.deepEqual(model.affectedModules, [
    "Inspections",
    "Stock Register",
    "Finance Review",
  ]);
  assert.match(model.auditNote, /No database write/i);
});

test("builds category and item module approval models", () => {
  const categoryModel = buildHitlReviewModel({
    name: "request_form_submit",
    args: { formId: "category_create", intent: "save" },
  });
  const itemModel = buildHitlReviewModel({
    name: "request_form_submit",
    args: { formId: "item_create", intent: "save" },
  });

  assert.equal(categoryModel.title, "Save category");
  assert.deepEqual(categoryModel.affectedModules, ["Categories"]);
  assert.equal(itemModel.title, "Save item");
  assert.deepEqual(itemModel.affectedModules, ["Items", "Stock Register"]);
});

test("builds approval model from live active form fields", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "inspection_detail_13_central_register", intent: "submit" },
      description: "Approve submitting the active AMS form?",
    },
    {
      readables: [
        {
          id: "inspection-detail",
          description: "Inspection detail",
          value: {
            route: "/inspections/13",
            page_kind: "detail",
            entity: "inspection",
            selected_record: {
              contract_no: "CTR-2026-001",
              stage: "CENTRAL_REGISTER",
            },
          },
        },
        {
          id: "active-form",
          description: "Active form",
          value: {
            route: "/inspections/13",
            activeForm: {
              formId: "inspection_detail_13_central_register",
              title: "Inspection Detail - Central Register",
              mode: "CENTRAL_REGISTER",
              fields: [
                {
                  name: "items.0.central_register",
                  label: "Item 1 Central Register",
                  type: "select",
                  options: [{ label: "DSR", value: 1 }],
                },
                {
                  name: "items.0.central_register_page_no",
                  label: "Item 1 Central Page Number",
                  type: "string",
                },
              ],
              values: {
                stage: "CENTRAL_REGISTER",
                items: [{ central_register: 1, central_register_page_no: "44" }],
              },
            },
          },
        },
        {
          id: "__ams_activity_context",
          description: "Activity",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "inspection_detail_13_central_register",
                fields: [
                  "items.0.central_register",
                  "items.0.central_register_page_no",
                ],
              },
            ],
          },
        },
      ],
      actions: [],
    },
  );

  assert.equal(model.recordLabel, "CTR-2026-001");
  assert.equal(model.description, "Review the filled and missing form fields before approving this submit.");
  assert.deepEqual(model.changePreview, [
    "Item 1 Central Register: DSR (1)",
    "Item 1 Central Page Number: 44",
  ]);
});

test("prefers assistant activity values when active form state is not refreshed yet", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "category-create", intent: "submit" },
    },
    {
      readables: [
        {
          id: "active-form",
          value: {
            activeForm: {
              formId: "category-create",
              title: "Create Category",
              fields: [
                { name: "name", label: "Category name", type: "string" },
                { name: "code", label: "Category code", type: "string" },
                {
                  name: "category_type",
                  label: "Category type",
                  type: "select",
                  options: [{ label: "Fixed Asset", value: "FIXED_ASSET" }],
                },
              ],
              values: {},
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "category-create",
                fields: ["name", "code", "category_type"],
                currentValues: {
                  name: "Laptop",
                  code: "LAPTOP",
                  category_type: "FIXED_ASSET",
                },
              },
            ],
          },
        },
      ],
    },
  );

  assert.deepEqual(model.changePreview, [
    "Category name: Laptop",
    "Category code: LAPTOP",
    "Category type: Fixed Asset (FIXED_ASSET)",
  ]);
});

test("keeps all changed fields and formats date values", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "inspection_detail_13_stock_details", intent: "submit" },
    },
    {
      readables: [
        {
          id: "active-form",
          value: {
            activeForm: {
              formId: "inspection_detail_13_stock_details",
              title: "Stock Details",
              fields: [
                { name: "items.0.stock_register", label: "Stock register", type: "select", options: [{ label: "SR-1", value: 1 }] },
                { name: "items.0.stock_register_page_no", label: "Stock page", type: "string" },
                { name: "items.0.stock_entry_date", label: "Stock entry date", type: "date" },
                { name: "items.0.batch_number", label: "Batch number", type: "string" },
                { name: "items.0.expiry_date", label: "Expiry date", type: "date" },
                { name: "items.0.manufactured_date", label: "Manufactured date", type: "date" },
                { name: "items.0.remarks", label: "Remarks", type: "string" },
                { name: "items.0.item", label: "Item", type: "select", options: [{ label: "Core i5", value: 9 }] },
                { name: "items.0.accepted_quantity", label: "Accepted quantity", type: "number" },
              ],
              values: {},
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "inspection_detail_13_stock_details",
                fields: [
                  "items.0.stock_register",
                  "items.0.stock_register_page_no",
                  "items.0.stock_entry_date",
                  "items.0.batch_number",
                  "items.0.expiry_date",
                  "items.0.manufactured_date",
                  "items.0.remarks",
                  "items.0.item",
                  "items.0.accepted_quantity",
                ],
                currentValues: {
                  items: [
                    {
                      stock_register: 1,
                      stock_register_page_no: "12",
                      stock_entry_date: "2026-05-20",
                      batch_number: "B-1",
                      expiry_date: "2027-05-20",
                      manufactured_date: "2026-01-01",
                      remarks: "Ready",
                      item: 9,
                      accepted_quantity: 4,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  );

  assert.equal(model.editableFields.length, 9);
  assert.deepEqual(model.changePreview.slice(0, 3), [
    "Stock register: SR-1 (1)",
    "Stock page: 12",
    "Stock entry date: 20/05/2026",
  ]);
});

test("expands bulk item JSON into editable child fields", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "inspection_detail_13_central_register", intent: "submit" },
    },
    {
      readables: [
        {
          id: "active-form",
          value: {
            activeForm: {
              formId: "inspection_detail_13_central_register",
              title: "Central Register",
              fields: [
                { name: "items.0.central_register", label: "Central register", type: "select", options: [{ label: "DSR", value: 1 }] },
                { name: "items.0.central_register_page_no", label: "Central page", type: "string" },
              ],
              values: {},
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "inspection_detail_13_central_register",
                fields: ["items"],
                currentValues: {
                  items: [{ central_register: 1, central_register_page_no: "44" }],
                },
              },
            ],
          },
        },
      ],
    },
  );

  assert.deepEqual(model.changePreview, [
    "Central register: DSR (1)",
    "Central page: 44",
  ]);
});

test("expands item rows from activity even when child schema is missing", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "inspection_create", intent: "save" },
    },
    {
      readables: [
        {
          id: "active-form",
          value: {
            activeForm: {
              formId: "inspection_create",
              title: "New Inspection",
              fields: [
                { name: "contract_no", label: "Contract Number", type: "string" },
                { name: "items", label: "Items", type: "array" },
              ],
              values: {},
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "inspection_create",
                fields: ["contract_no", "items"],
                currentValues: {
                  contract_no: "CTR-1",
                  items: [
                    {
                      item_description: "Laptop",
                      tendered_quantity: 2,
                      accepted_quantity: 2,
                      rejected_quantity: 0,
                      unit_price: 1000,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  );

  assert.deepEqual(model.changePreview, [
    "Contract Number: CTR-1",
    "Items 0 Item Description: Laptop",
    "Items 0 Tendered Quantity: 2",
    "Items 0 Accepted Quantity: 2",
    "Items 0 Rejected Quantity: 0",
    "Items 0 Unit Price: 1000",
  ]);
});

test("adds missing required fields to the approval form", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "category-create", intent: "submit" },
    },
    {
      readables: [
        {
          id: "active-form",
          value: {
            activeForm: {
              formId: "category-create",
              title: "Create Category",
              fields: [
                { name: "name", label: "Category name", type: "string", required: true },
                { name: "category_type", label: "Category type", type: "select", required: true, options: [{ label: "Fixed Asset", value: "FIXED_ASSET" }] },
                { name: "notes", label: "Notes", type: "string" },
              ],
              values: {},
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "category-create",
                fields: ["name"],
                currentValues: { name: "Laptop" },
              },
            ],
          },
        },
      ],
    },
  );

  assert.deepEqual(model.editableFields.map((field) => field.name), [
    "name",
    "category_type",
  ]);
  assert.equal(model.editableFields[0].missing, false);
  assert.equal(model.editableFields[1].required, true);
  assert.equal(model.editableFields[1].missing, true);
});

test("approval fields show all currently filled form values, not only latest assistant change", () => {
  const model = buildHitlReviewModel(
    {
      name: "request_form_submit",
      args: { formId: "category-create", intent: "submit" },
    },
    {
      readables: [
        {
          id: "active-form",
          value: {
            activeForm: {
              formId: "category-create",
              title: "Create Category",
              fields: [
                { name: "name", label: "Category name", type: "string", required: true },
                { name: "code", label: "Category code", type: "string" },
                {
                  name: "category_type",
                  label: "Category type",
                  type: "select",
                  required: true,
                  options: [{ label: "Fixed Asset", value: "FIXED_ASSET" }],
                },
                { name: "tracking_type", label: "Tracking type", type: "select", required: true },
                { name: "notes", label: "Notes", type: "string" },
              ],
              values: {
                name: "Computer Accessories",
                code: "COMP-ACC",
                category_type: "FIXED_ASSET",
              },
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            recentActivity: [
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "category-create",
                fields: ["name", "code"],
                currentValues: {
                  name: "Computer Accessories",
                  code: "COMP-ACC",
                },
              },
              {
                kind: "form_values_set",
                actor: "assistant",
                formId: "category-create",
                fields: ["category_type"],
                currentValues: {
                  category_type: "FIXED_ASSET",
                },
              },
            ],
          },
        },
      ],
    },
  );

  assert.deepEqual(model.changePreview, [
    "Category name: Computer Accessories",
    "Category code: COMP-ACC",
    "Category type: Fixed Asset (FIXED_ASSET)",
    "Tracking type: Not set",
  ]);
  assert.deepEqual(model.editableFields.map((field) => field.name), [
    "name",
    "code",
    "category_type",
    "tracking_type",
  ]);
  assert.equal(model.editableFields.at(-1)?.missing, true);
});
