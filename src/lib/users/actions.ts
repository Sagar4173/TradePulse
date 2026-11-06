"use server";

import { revalidatePath } from "next/cache";

import {
  PERMISSIONS,
  hasPermission,
} from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import {
  isSelfAccessChange,
  validateAccessAssignment,
} from "@/lib/auth/user-access";
import type {
  ReviewRetailerLinkState,
  UpdateUserAccessState,
} from "./action-types";
import { RETAILER_LINK_DECISIONS } from "./retailer-linking";
import { reviewRetailerLink, updateUserAccess } from "./repository";

export async function updateUserAccessAction(
  _previousState: UpdateUserAccessState,
  formData: FormData,
): Promise<UpdateUserAccessState> {
  const session = await getSession();

  if (!session) {
    return {
      status: "error",
      message: "Your session has expired. Sign in again.",
    };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.USERS_MANAGE)) {
    return {
      status: "error",
      message: "You do not have permission to manage users.",
    };
  }

  const targetUserId = String(formData.get("userId") ?? "").trim();

  if (!targetUserId) {
    return { status: "error", message: "Select a valid user." };
  }

  if (isSelfAccessChange(session.user.id, targetUserId)) {
    return {
      status: "error",
      message: "You cannot change your own role or account status.",
    };
  }

  const assignment = validateAccessAssignment({
    role: String(formData.get("role") ?? ""),
    status: String(formData.get("status") ?? ""),
    retailerId: String(formData.get("retailerId") ?? "") || null,
    assignedRetailerIds: formData
      .getAll("assignedRetailerIds")
      .map((value) => String(value)),
  });

  if (!assignment.ok) {
    return { status: "error", message: assignment.error };
  }

  try {
    const result = await updateUserAccess({
      actorId: session.user.id,
      targetUserId,
      assignment: assignment.value,
    });

    if (!result.ok) {
      return { status: "error", message: result.error };
    }

    revalidatePath("/users");
    return { status: "success", message: "User access updated." };
  } catch {
    return {
      status: "error",
      message: "We could not update this user. Please try again.",
    };
  }
}

export async function reviewRetailerLinkAction(
  _previousState: ReviewRetailerLinkState,
  formData: FormData,
): Promise<ReviewRetailerLinkState> {
  const session = await getSession();

  if (!session) {
    return {
      status: "error",
      message: "Your session has expired. Sign in again.",
    };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.USERS_MANAGE)) {
    return {
      status: "error",
      message: "You do not have permission to review retailer link requests.",
    };
  }

  const requestId = String(formData.get("requestId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "");

  if (!requestId) {
    return { status: "error", message: "Select a valid link request." };
  }

  if (
    !RETAILER_LINK_DECISIONS.includes(
      decision as (typeof RETAILER_LINK_DECISIONS)[number],
    )
  ) {
    return { status: "error", message: "Select a valid review decision." };
  }

  try {
    // The repository re-reads the administrator and request inside a
    // serializable transaction; this action-layer check is only the first gate.
    const result = await reviewRetailerLink({
      actorId: session.user.id,
      requestId,
      decision: decision as (typeof RETAILER_LINK_DECISIONS)[number],
    });

    if (!result.ok) {
      return { status: "error", message: result.error };
    }

    revalidatePath("/users");
    return {
      status: "success",
      message:
        result.decision === "APPROVE"
          ? "Retailer link approved and audited."
          : "Retailer link rejected and audited.",
    };
  } catch {
    return {
      status: "error",
      message: "We could not review this link request. Please try again.",
    };
  }
}
