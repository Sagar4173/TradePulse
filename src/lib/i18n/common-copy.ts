export type RouteErrorCopy = {
  title: string;
  description: string;
  retry: string;
};

export const routeErrorCopy: RouteErrorCopy = {
  title: "This page could not be loaded",
  description:
    "No private data is shown here. Try again, or return to the dashboard if the problem continues.",
  retry: "Try again",
};
