const AMS_ROUTE_PATTERN = /^\/[A-Za-z0-9/_?=&.%#-]*$/;

export function isAmsRelativeRoute(url: unknown): url is string {
  return (
    typeof url === "string" &&
    AMS_ROUTE_PATTERN.test(url.trim()) &&
    !url.trim().startsWith("//")
  );
}
