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
];

function formatForm(contract: CreateFormContract) {
  const scope = contract.samePageOnly
    ? `same-page only on ${contract.routePattern}`
    : `cross-page route ${contract.route}`;
  const capability = contract.requiredCapability
    ? `; requires ${contract.requiredCapability}`
    : "";
  return `${contract.formId} (${scope}${capability})`;
}

function formatModule(module: ModuleContract) {
  const forms = [
    module.createForm ? formatForm(module.createForm) : null,
    ...(module.scopedForms ?? []).map(formatForm),
  ].filter(Boolean);

  return [
    `- ${module.label}: list ${module.listRoute}; detail ${module.detailRoutePattern}${
      module.viewCapability ? `; view capability ${module.viewCapability}` : ""
    }.`,
    forms.length > 0
      ? `  Forms opened through run_frontend_action("open_form"): ${forms.join("; ")}.`
      : "  No create form is exposed through the compact module manifest.",
  ].join("\n");
}

export const AMS_MODULE_CONTRACTS_PROMPT = `AMS COPILOT MODULE MANIFEST (COMPACT):
This is a compact routing/action summary only. The current live page state is authoritative for visible rows, detail records, active form schema, writable fields, dropdown options, workflow stage, permissions, and allowed/blocked frontend actions.

${AMS_COPILOT_MODULES.map(formatModule).join("\n")}

Production rule: use this compact manifest only to choose high-level navigation/open_form targets. Use LIVE PAGE STATE and registered frontend actions for page-specific data, form filling, workflow, validation, and permissions. Use SQL only for read/reporting questions or when live context does not contain the referenced record.`;
