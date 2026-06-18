type CreateFormContract = {
  formId: string;
  route?: string;
  routePattern?: string;
  samePageOnly?: boolean;
  requiredCapability?: string;
};

type ModuleContract = {
  id: string;
  label: string;
  listRoute: string;
  detailRoutePattern: string;
  viewCapability?: string;
  createForm?: CreateFormContract;
  scopedForms?: CreateFormContract[];
  // One-line hint about write actions available on the DETAIL page that are
  // registered at runtime (not opened via open_form). The live page state is
  // still authoritative for which of these are actually allowed right now.
  detailWorkflow?: string;
};

const AMS_COPILOT_MODULES: ModuleContract[] = [
  {
    id: "inspections",
    label: "Inspections",
    listRoute: "/inspections",
    detailRoutePattern: "/inspections/{id}",
    viewCapability: "inspections:view",
    createForm: {
      formId: "inspection_create",
      route: "/inspections",
      requiredCapability: "inspections:manage",
    },
    detailWorkflow:
      "Detail page auto-opens the current stage form; advance it with request_form_submit intent submit (submit / approve / return / reject). Do NOT open_form for stages.",
  },
  {
    id: "locations",
    label: "Locations",
    listRoute: "/locations",
    detailRoutePattern: "/locations/{id}",
    viewCapability: "locations:view",
    createForm: {
      formId: "location_create",
      route: "/locations",
      requiredCapability: "locations:manage",
    },
    scopedForms: [
      {
        formId: "sublocation_create",
        routePattern: "/locations/{id}",
        samePageOnly: true,
        requiredCapability: "locations:manage",
      },
    ],
  },
  {
    id: "categories",
    label: "Categories",
    listRoute: "/categories",
    detailRoutePattern: "/categories/{id}",
    viewCapability: "categories:view",
    createForm: {
      formId: "category_create",
      route: "/categories",
      requiredCapability: "categories:manage",
    },
    scopedForms: [
      {
        formId: "subcategory_create",
        routePattern: "/categories/{id}",
        samePageOnly: true,
        requiredCapability: "categories:manage",
      },
    ],
  },
  {
    id: "items",
    label: "Items",
    listRoute: "/items",
    detailRoutePattern: "/items/{id}",
    viewCapability: "items:view",
    createForm: {
      formId: "item_create",
      route: "/items",
      requiredCapability: "items:manage",
    },
    scopedForms: [
      {
        formId: "item_instance_create",
        routePattern: "/items/{id}",
        samePageOnly: true,
        requiredCapability: "items:manage",
      },
      {
        formId: "item_batch_create",
        routePattern: "/items/{id}",
        samePageOnly: true,
        requiredCapability: "items:manage",
      },
    ],
    detailWorkflow:
      "Instances (INDIVIDUAL / serial-QR items) and batches (QUANTITY / bulk items) are child records of the item — open item_instance_create or item_batch_create on the item detail page. Pick the one matching the item's tracking_type.",
  },
  {
    id: "stock-entries",
    label: "Stock Entries",
    listRoute: "/stock-entries",
    detailRoutePattern: "/stock-entries/{id}",
    viewCapability: "stock-entries:view",
    createForm: {
      formId: "stock_entry_create",
      route: "/stock-entries",
      requiredCapability: "stock-entries:manage",
    },
    detailWorkflow:
      "Detail page exposes the acknowledge / receive step for a RECEIPT entry; run it through the registered submit action (request_form_submit intent submit) so human approval applies. Stock is only received once it returns ok=true.",
  },
  {
    id: "stock-registers",
    label: "Stock Registers",
    listRoute: "/stock-registers",
    detailRoutePattern: "/stock-registers/{id}",
    viewCapability: "stock-registers:view",
    createForm: {
      formId: "stock_register_create",
      route: "/stock-registers",
      requiredCapability: "stock-registers:manage",
    },
  },
  {
    id: "maintenance",
    label: "Maintenance",
    listRoute: "/maintenance",
    detailRoutePattern: "/maintenance/{id}",
    viewCapability: "maintenance:view",
    detailWorkflow:
      "Copilot can navigate and read maintenance work orders. There is NO copilot create form yet — to create or edit one, tell the user to use the create/edit button on the page.",
  },
  {
    id: "depreciation",
    label: "Depreciation",
    listRoute: "/depreciation",
    detailRoutePattern: "/depreciation/{id}",
    viewCapability: "depreciation:view",
    detailWorkflow:
      "Copilot can navigate and read depreciation records. There is NO copilot create form yet — to record or adjust depreciation, tell the user to use the page's button.",
  },
  {
    id: "users",
    label: "Users",
    listRoute: "/users",
    detailRoutePattern: "/users/{id}",
    viewCapability: "users:view",
    detailWorkflow:
      "Admin module. Copilot can navigate and read users. Managing users is done in the AMS admin UI — no copilot create form.",
  },
  {
    id: "roles",
    label: "Roles",
    listRoute: "/roles",
    detailRoutePattern: "/roles/{id}",
    viewCapability: "roles:view",
    detailWorkflow:
      "Admin module. Copilot can navigate and read roles. Managing roles is done in the AMS admin UI — no copilot create form.",
  },
];

function formatForm(contract: CreateFormContract): string {
  const attrs: string[] = [`form_id="${contract.formId}"`];
  if (contract.samePageOnly) {
    attrs.push(`scope="same-page"`);
    if (contract.routePattern) {
      attrs.push(`parent_route="${contract.routePattern}"`);
    }
  } else {
    attrs.push(`scope="cross-page"`);
    if (contract.route) {
      attrs.push(`route="${contract.route}"`);
    }
  }
  if (contract.requiredCapability) {
    attrs.push(`requires="${contract.requiredCapability}"`);
  }
  return `    <form ${attrs.join(" ")}/>`;
}

function formatModule(module: ModuleContract): string {
  const attrs: string[] = [
    `name="${module.label}"`,
    `list_route="${module.listRoute}"`,
    `detail_route="${module.detailRoutePattern}"`,
  ];
  if (module.viewCapability) {
    attrs.push(`view_capability="${module.viewCapability}"`);
  }

  const lines: string[] = [];
  if (module.createForm) lines.push(formatForm(module.createForm));
  for (const scoped of module.scopedForms ?? []) {
    lines.push(formatForm(scoped));
  }
  if (module.detailWorkflow) {
    lines.push(`    <detail_actions>${module.detailWorkflow}</detail_actions>`);
  }

  if (lines.length === 0) {
    return `  <module ${attrs.join(" ")}>
    <!-- no create form exposed through the compact manifest -->
  </module>`;
  }

  return `  <module ${attrs.join(" ")}>
${lines.join("\n")}
  </module>`;
}

export const AMS_MODULE_CONTRACTS_PROMPT = `<module_manifest>
AMS COPILOT MODULE MANIFEST (COMPACT):

This is a compact routing/action summary only. The current live page state is authoritative for visible rows, detail records, active form schema, writable fields, dropdown options, workflow stage, permissions, and allowed/blocked frontend actions.

Each <form> is opened through run_frontend_action with name "open_form" and args { form_id: "..." }. A scope="cross-page" form handles BOTH navigation and modal open in one call. A scope="same-page" form requires you to navigate to its parent_route first, then open it on the next turn.

<modules>
${AMS_COPILOT_MODULES.map(formatModule).join("\n")}
</modules>

Production rule: use this compact manifest only to choose high-level navigation/open_form targets. Use LIVE PAGE STATE and registered frontend actions for page-specific data, form filling, workflow, validation, and permissions. If live context does not contain the referenced record, use registered navigation, filters, or row-open actions when available; otherwise ask the user to open or filter the relevant AMS page.
</module_manifest>`;
