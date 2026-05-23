import assert from "node:assert/strict";
import test from "node:test";

import { formatPageContextForPrompt } from "./page-context-middleware.js";

test("page context prompt includes visible rows for current list page", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: {
          route: {
            pathname: "/categories",
            observed_at: "2026-05-20T00:00:00.000Z",
          },
          user: { id: 1, username: "admin", is_superuser: true },
        },
      },
      {
        id: "category-list-readable",
        description:
          "Categories displayed on the /categories list page after filters/pagination.",
        value: {
          route: "/categories",
          total: 9,
          filtered_total: 9,
          pagination: { page: 1, page_size: 10, total_pages: 1 },
          visible_rows: [
            {
              row_number: 1,
              id: 1,
              name: "IT Equipment",
              code: "CAT-0001",
              category_type: "FIXED_ASSET",
              detail_route: "/categories/1",
              available_actions: { open_detail: true },
            },
            {
              row_number: 2,
              id: 2,
              name: "Processor",
              code: "SUB-0002",
              category_type: "CONSUMABLE",
              detail_route: "/categories/2",
            },
          ],
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /## VISIBLE PAGE ROWS/);
  assert.match(prompt, /the first one/);
  assert.match(prompt, /<visible_list route="\/categories"/);
  assert.match(prompt, /1\. row_number=1, id=1, name=IT Equipment/);
  assert.match(prompt, /available_actions=\{open_detail=true\}/);
  assert.match(prompt, /2\. row_number=2, id=2, name=Processor/);
  assert.match(prompt, /route: \/categories; visible rows: 2; filtered total: 9/);
});

test("page context prompt distinguishes writable form fields from value context", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "active-form",
        description: "Active form",
        value: {
          activeForm: {
            formId: "inspection_detail_13_central_register",
            title: "Inspection Detail - Central Register",
            mode: "CENTRAL_REGISTER",
            fields: [
              {
                name: "items.0.central_register",
                label: "Item 1 Central Register",
                type: "select",
                options: [{ label: "CENT-STORE", value: 5 }],
              },
              {
                name: "items",
                label: "Items",
                type: "array",
                arrayItemFields: [
                  { name: "central_register", type: "select" },
                  { name: "central_register_page_no", type: "string" },
                  { name: "item", type: "select" },
                ],
              },
              {
                name: "items.0.central_register_page_no",
                label: "Item 1 Central Page Number",
                type: "string",
                required: true,
              },
            ],
            setValuesSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      central_register: { type: "number" },
                      central_register_page_no: { type: "string" },
                      item: { type: "number" },
                    },
                  },
                },
              },
            },
            values: {
              finance_check_date: null,
              items: [{ index: 0, item_description: "core i5" }],
            },
            allowedActions: { set_form_values: true, request_form_submit: true },
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /Writable field schema/);
  assert.match(prompt, /ONLY these exact names are fillable/);
  assert.match(prompt, /arrayItemFields=\[central_register\(type=select\), central_register_page_no\(type=string\), item\(type=select\)\]/);
  assert.match(prompt, /set_form_values\.values JSON schema/);
  assert.match(prompt, /items\.0\.central_register; type=select/);
  assert.match(prompt, /items\.0\.central_register_page_no; type=string; label="Item 1 Central Page Number"; required=true/);
  assert.match(prompt, /CENT-STORE=5/);
  assert.match(prompt, /Current values\/context snapshot/);
  assert.match(prompt, /not all keys are writable/);
  assert.match(prompt, /finance_check_date/);
});

test("page context prompt includes form option dependency metadata and truncated previews", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "active-form",
        description: "Active form",
        value: {
          activeForm: {
            formId: "stock-entry-create",
            title: "Create Stock Entry",
            fields: [
              {
                name: "items",
                label: "Line items",
                type: "array",
                arrayItemFields: [
                  {
                    name: "instances",
                    label: "Instances",
                    type: "array",
                    optionsState: "truncated",
                    optionsPreview: [
                      { label: "SN-001", value: "35" },
                      { label: "SN-002", value: "36" },
                    ],
                    totalCount: 482,
                    hasMore: true,
                    dependsOn: ["from_location", "items[].item"],
                    optionSource: "stockEntry.availableInstances",
                    resolver: "search_form_options",
                  },
                ],
              },
            ],
            values: { from_location: "5", items: [{ item: "3" }] },
            allowedActions: {
              set_form_values: true,
              search_form_options: true,
              request_form_submit: true,
            },
          },
        },
      },
    ],
    actions: [
      { name: "set_form_values", description: "Patch form.", parameters: {} },
      { name: "search_form_options", description: "Search options.", parameters: {} },
      { name: "request_form_submit", description: "Submit form.", parameters: {} },
    ],
  });

  assert.match(prompt, /items; type=array/);
  assert.match(prompt, /instances\(type=array/);
  assert.match(prompt, /optionsState=truncated/);
  assert.match(prompt, /optionsPreview=\[SN-001=35, SN-002=36\]/);
  assert.match(prompt, /totalCount=482/);
  assert.match(prompt, /hasMore=true/);
  assert.match(prompt, /dependsOn=\[from_location, items\[\]\.item\]/);
  assert.match(prompt, /optionSource=stockEntry\.availableInstances/);
  assert.match(prompt, /resolver=search_form_options/);
  assert.match(prompt, /Allowed form actions: set_form_values, search_form_options, request_form_submit/);
});

test("page context prompt exposes manual submit continuation details", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: {
          route: {
            pathname: "/inspections",
            observed_at: "2026-05-22T10:00:00.000Z",
          },
        },
      },
      {
        id: "__ams_activity_context",
        description: "Activity",
        value: {
          lastSubmitResult: {
            formId: "inspection_create",
            formTitle: "New Inspection Certificate",
            ok: true,
            message: "Inspection certificate submitted successfully.",
            result: {
              ok: true,
              recordId: 35,
              redirectTo: "/inspections/35",
            },
            at: "2026-05-22T10:00:03.000Z",
          },
          lastClosedForm: {
            formId: "inspection_create",
            title: "New Inspection Certificate",
            route: "/inspections",
            closedAt: "2026-05-22T10:00:04.000Z",
          },
          recentActivity: [
            {
              at: "2026-05-22T10:00:02.000Z",
              actor: "user",
              kind: "form_submit_requested",
              title: "Manual submit requested for New Inspection Certificate",
            },
            {
              at: "2026-05-22T10:00:03.000Z",
              actor: "user",
              kind: "form_submit_result",
              title: "Manual submit succeeded for New Inspection Certificate",
            },
          ],
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /Last submit: .*OK.*New Inspection Certificate/);
  assert.match(prompt, /recordId=35/);
  assert.match(prompt, /redirectTo=\/inspections\/35/);
  assert.match(prompt, /Last closed form: New Inspection Certificate/);
  assert.match(prompt, /Manual submit succeeded/);
});

test("page context prompt hides internal form helper actions from the agent", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "active-form",
        description: "Active form",
        value: {
          activeForm: {
            formId: "inspection_create",
            title: "Inspection",
            fields: [{ name: "contract_no", type: "string" }],
            allowedActions: {
              set_form_values: true,
              focus_form_field: true,
              validate_active_form: true,
              request_form_submit: true,
            },
          },
        },
      },
    ],
    actions: [
      { name: "set_form_values", description: "Patch form.", parameters: {} },
      { name: "focus_form_field", description: "Focus field.", parameters: {} },
      {
        name: "validate_active_form",
        description: "Validate form.",
        parameters: {},
      },
      { name: "request_form_submit", description: "Submit form.", parameters: {} },
    ],
  });

  assert.match(prompt, /Allowed form actions: set_form_values, request_form_submit/);
  assert.doesNotMatch(prompt, /focus_form_field/);
  assert.doesNotMatch(prompt, /validate_active_form/);
});

test("page context prompt includes current detail readable data as the primary source", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: {
          route: {
            pathname: "/inspections/13",
            observed_at: "2026-05-20T00:00:00.000Z",
          },
          user: { id: 1, username: "admin", is_superuser: true },
        },
      },
      {
        id: "inspection-detail",
        description: "Inspection detail page contract.",
        value: {
          route: "/inspections/13",
          page_kind: "detail",
          entity: "inspection",
          selected_record: {
            id: 13,
            contract_no: "CTR-2026-001",
            contractor_name: "ABC Supplies Ltd.",
            stage: "COMPLETED",
          },
          items: [
            {
              id: 44,
              item_description: "core i5",
              accepted_quantity: 1,
              central_register_no: "DSR",
            },
          ],
          documents: [{ id: 9, label: "Invoice" }],
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /## DETAIL PAGE CONTEXT/);
  assert.match(prompt, /Use this detail context as the primary source/);
  assert.match(prompt, /"entity":"inspection"/);
  assert.match(prompt, /"contract_no":"CTR-2026-001"/);
  assert.match(prompt, /"item_description":"core i5"/);
  assert.match(prompt, /"documents":\[\{"id":9,"label":"Invoice"\}\]/);
});

test("page context prompt includes supporting route readables such as catalogs", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: { route: { pathname: "/inspections/13" } },
      },
      {
        id: "inspection-catalogs",
        description: "Inspection detail dropdown catalogs.",
        value: {
          route: "/inspections/13",
          stage: "CENTRAL_REGISTER",
          items: [{ id: 1, name: "core i5", code: "ITM-0001" }],
          stock_registers: [{ id: 1, register_number: "DSR" }],
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /## SUPPORTING PAGE CONTEXT/);
  assert.match(prompt, /Inspection detail dropdown catalogs/);
  assert.match(prompt, /"name":"core i5"/);
  assert.match(prompt, /"register_number":"DSR"/);
});

test("page context prompt ignores stale readables from a previous route", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: { route: { pathname: "/inspections/13" } },
      },
      {
        id: "locations-list",
        description: "Locations displayed on the /locations page.",
        value: {
          route: "/locations",
          visible_rows: [
            {
              id: 4,
              name: "NED",
              code: "DEPT-0001",
              detail_route: "/locations/4",
            },
          ],
        },
      },
      {
        id: "location-form",
        description: "Active location form.",
        value: {
          route: "/locations",
          activeForm: {
            formId: "location_create",
            title: "Location",
            fields: [{ name: "name", label: "Name", type: "string" }],
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /Current route: \/inspections\/13/);
  assert.doesNotMatch(prompt, /## VISIBLE PAGE ROWS/);
  assert.doesNotMatch(prompt, /NED/);
  assert.doesNotMatch(prompt, /location_create/);
});

test("page context hides array item fields with unresolved dependencies and shows deferred summary", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "active-form",
        description: "Active form",
        value: {
          activeForm: {
            formId: "stock-entry-create",
            title: "Create Stock Entry",
            fields: [
              {
                name: "items",
                label: "Line items",
                type: "array",
                required: true,
                dependsOn: ["from_location"],
                arrayItemFields: [
                  {
                    name: "item",
                    label: "Item",
                    type: "select",
                    required: true,
                    optionsState: "complete",
                    dependsOn: ["from_location"],
                    options: [
                      { label: "core i5 (ITM-0001)", value: "1" },
                      { label: "Core i7 (ITM-0003)", value: "3" },
                    ],
                  },
                  {
                    name: "quantity",
                    label: "Quantity",
                    type: "number",
                    required: true,
                  },
                  {
                    name: "instances",
                    label: "Instance IDs",
                    type: "array",
                    optionsState: "requires_dependency",
                    dependsOn: ["from_location", "items[].item"],
                    missingDependencies: ["items[].item"],
                    resolver: "search_form_options",
                  },
                  {
                    name: "batch",
                    label: "Batch",
                    type: "select",
                    optionsState: "requires_dependency",
                    dependsOn: ["items[].item"],
                    missingDependencies: ["items[].item"],
                    resolver: "search_form_options",
                  },
                  {
                    name: "stock_register",
                    label: "Source register",
                    type: "select",
                    optionsState: "complete",
                    options: [{ label: "DSR", value: "1" }],
                  },
                ],
              },
            ],
            values: { entry_type: "ISSUE", from_location: "5" },
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /item\(type=select/);
  assert.match(prompt, /quantity\(type=number/);
  assert.match(prompt, /stock_register\(type=select/);

  assert.doesNotMatch(prompt, /instances\(type=array/);
  assert.doesNotMatch(prompt, /batch\(type=select/);

  assert.match(prompt, /deferredFields=\[instances \(needs items\[\]\.item\), batch \(needs items\[\]\.item\)\]/);
});

test("page context hides top-level fields with unresolved dependencies", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "active-form",
        description: "Active form",
        value: {
          activeForm: {
            formId: "stock-entry-create",
            title: "Create Stock Entry",
            fields: [
              {
                name: "entry_type",
                label: "Entry type",
                type: "select",
                required: true,
                optionsState: "complete",
                options: [
                  { label: "Transfer", value: "ISSUE" },
                  { label: "Receipt", value: "RECEIPT" },
                ],
              },
              {
                name: "to_location",
                label: "Destination",
                type: "select",
                required: true,
                dependsOn: ["entry_type", "issue_target", "from_location"],
                missingDependencies: ["entry_type", "issue_target", "from_location"],
                optionsState: "requires_dependency",
              },
              {
                name: "items",
                label: "Line items",
                type: "array",
                dependsOn: ["from_location"],
                missingDependencies: ["from_location"],
              },
            ],
            values: {},
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /entry_type; type=select/);

  assert.doesNotMatch(prompt, /to_location; type=select/);
  assert.doesNotMatch(prompt, /items; type=array/);

  assert.match(prompt, /Deferred fields/);
  assert.match(prompt, /to_location \(needs entry_type, issue_target, from_location\)/);
  assert.match(prompt, /items \(needs from_location\)/);
});

test("page context shows all fields when dependencies are resolved (empty missingDependencies)", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "active-form",
        description: "Active form",
        value: {
          activeForm: {
            formId: "stock-entry-create",
            title: "Create Stock Entry",
            fields: [
              {
                name: "items",
                label: "Line items",
                type: "array",
                dependsOn: ["from_location"],
                arrayItemFields: [
                  {
                    name: "item",
                    type: "select",
                    optionsState: "complete",
                    dependsOn: ["from_location"],
                    options: [{ label: "core i5", value: "1" }],
                  },
                  {
                    name: "instances",
                    type: "array",
                    optionsState: "truncated",
                    dependsOn: ["from_location", "items[].item"],
                    missingDependencies: [],
                    optionsPreview: [{ label: "SN-001", value: "35" }],
                  },
                ],
              },
            ],
            values: { from_location: "5", items: [{ item: "1" }] },
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /item\(type=select/);
  assert.match(prompt, /instances\(type=array/);
  assert.doesNotMatch(prompt, /deferredFields/);
});

test("page context injects workflow guidance for stock_entry_create form", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: {
          route: { pathname: "/stock-entries", observed_at: "2026-05-23T00:00:00Z" },
          user: { id: 1, username: "admin", is_superuser: true },
        },
      },
      {
        id: "stock-entry-form",
        description: "Stock entry form",
        value: {
          route: "/stock-entries",
          activeForm: {
            formId: "stock_entry_create",
            title: "Create Stock Entry",
            mode: "create",
            fields: [
              { name: "entry_type", type: "select", required: true, options: [{ label: "Receipt", value: "RECEIPT" }] },
              { name: "items", type: "array", arrayItemFields: [{ name: "item", type: "select" }] },
            ],
            values: {},
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /WORKFLOW for Stock Entry/);
  assert.match(prompt, /Set entry_type FIRST/);
  assert.match(prompt, /set the `item` field FIRST/);
});

test("page context injects workflow guidance for inspection stage form with dynamic ID", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: {
          route: { pathname: "/inspections/47", observed_at: "2026-05-23T00:00:00Z" },
          user: { id: 1, username: "admin", is_superuser: true },
        },
      },
      {
        id: "inspection-stage-form",
        description: "Inspection central register stage",
        value: {
          route: "/inspections/47",
          activeForm: {
            formId: "inspection-detail-47-central_register",
            title: "Central Register",
            mode: "edit",
            fields: [
              { name: "items", type: "array", arrayItemFields: [
                { name: "central_register", type: "select" },
                { name: "item", type: "select" },
              ]},
            ],
            values: {},
          },
        },
      },
    ],
    actions: [],
  });

  assert.match(prompt, /WORKFLOW for Central Register stage/);
  assert.match(prompt, /central_register.*central_register_page_no.*item/);
});

test("page context does not inject workflow guidance for unknown form", () => {
  const prompt = formatPageContextForPrompt({
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Runtime",
        value: {
          route: { pathname: "/some-page", observed_at: "2026-05-23T00:00:00Z" },
          user: { id: 1, username: "admin", is_superuser: true },
        },
      },
      {
        id: "unknown-form",
        description: "Unknown form",
        value: {
          route: "/some-page",
          activeForm: {
            formId: "custom_module_xyz_create",
            title: "Custom Module",
            fields: [{ name: "name", type: "text" }],
            values: {},
          },
        },
      },
    ],
    actions: [],
  });

  assert.doesNotMatch(prompt, /WORKFLOW for/);
});
