// Re-export the Backend interface so backend packages depend only on backend-base.
export type {
  Backend,
  BackendCapabilities,
  ChatHandle,
} from "@delego/types";
