export type UpdateUserAccessState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const INITIAL_USER_ACCESS_STATE: UpdateUserAccessState = {
  status: "idle",
  message: "",
};

export type ReviewRetailerLinkState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const INITIAL_REVIEW_RETAILER_LINK_STATE: ReviewRetailerLinkState = {
  status: "idle",
  message: "",
};
