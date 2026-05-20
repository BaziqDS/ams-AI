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
  assert.match(prompt, /1\. \{"row_number":1,"id":1,"name":"IT Equipment"/);
  assert.match(prompt, /"available_actions":\{"open_detail":true\}/);
  assert.match(prompt, /2\. \{"row_number":2,"id":2,"name":"Processor"/);
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
                name: "items.0.central_register_page_no",
                label: "Item 1 Central Page Number",
                type: "string",
                required: true,
              },
            ],
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
  assert.match(prompt, /items\.0\.central_register; type=select/);
  assert.match(prompt, /items\.0\.central_register_page_no; type=string; label="Item 1 Central Page Number"; required=true/);
  assert.match(prompt, /CENT-STORE=5/);
  assert.match(prompt, /Current values\/context snapshot/);
  assert.match(prompt, /not all keys are writable/);
  assert.match(prompt, /finance_check_date/);
});

test("page context prompt includes current detail readable data before SQL is needed", () => {
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
  assert.match(prompt, /Use this detail context before SQL/);
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
