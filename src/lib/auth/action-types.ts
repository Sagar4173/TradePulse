export type RequestOtpState = {
  status: "idle" | "sent" | "error";
  message: string;
  challengeId: string | null;
  phone: string | null;
  devCode: string | null;
  resendAt: number | null;
  expiresAt: number | null;
};

export const INITIAL_REQUEST_OTP_STATE: RequestOtpState = {
  status: "idle",
  message: "",
  challengeId: null,
  phone: null,
  devCode: null,
  resendAt: null,
  expiresAt: null,
};

export type VerifyOtpState = {
  status: "idle" | "error";
  message: string;
  challengeId: string | null;
};

export const INITIAL_VERIFY_OTP_STATE: VerifyOtpState = {
  status: "idle",
  message: "",
  challengeId: null,
};
