/** Shared domain types for the MiniPLM work area features. */

export interface UserRef {
  id?: number;
  loginName: string;
  name: string;
  surname: string;
}

export interface Workspace {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  title: string | null;
  parentId: number | null;
  parentName: string | null;
  createdBy: UserRef | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkContainer {
  id: number;
  identifier: string;
  projectId: number;
  projectName: string;
  workspaceId: number | null;
  workspaceName: string | null;
  title: string | null;
  description: string | null;
  progress: string | null;
  /** Workflow descriptor of the container template's progress field, if any. */
  progressWorkflow?: ProgressWorkflow | null;
  templateId: number | null;
  templateName: string | null;
  fields: WorkInstanceField[];
  author: UserRef | null;
  createdAt: string | null;
  updatedAt: string | null;
  instanceCount: number;
}

export interface HistoryEntry {
  action: string;
  changedFields: string[];
  at: string | null;
  user: UserRef | null;
}

export interface FieldDef {
  name: string;
  type: string;
  description?: string;
  customType?: string | null;
}

export interface WorkInstanceField {
  name: string;
  type: string;
  value: unknown;
  customType?: string | null;
  description?: string;
}

export interface WorkInstance {
  id: number;
  instanceId: string;
  title: string;
  projectId: number;
  projectName: string;
  workContainerId: number;
  workContainerIdentifier: string;
  workContainerTitle: string | null;
  templateId: number | null;
  templateName: string | null;
  progress: string | null;
  /** Workflow descriptor of the instance template's progress field, if any. */
  progressWorkflow?: ProgressWorkflow | null;
  assigneeIds: number[];
  assignees?: UserRef[];
  fields: WorkInstanceField[];
  author: UserRef | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InstanceTemplate {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  definition: FieldDef[];
  /**
   * Resolved workflow descriptor of the template progress field (null when
   * the template has no progress field or the referenced type is disabled).
   */
  progressWorkflow?: ProgressWorkflow | null;
  createdAt: string | null;
  updatedAt: string | null;
  usedByCount: number;
}

export interface CustomTypeOption {
  label: string;
  value: string;
}

export interface CustomType {
  id: number;
  name: string;
  valueType: string;
  multiSelect: boolean;
  category: string;
  options: CustomTypeOption[];
  isDisabled: boolean;
  /** Workflow only: the option value that represents the initial state. */
  initialState?: string | null;
  /** Workflow only: allowed state-to-state transitions. */
  transitions?: WorkflowTransition[];
  /** Workflow only: the role list ID that defines available roles. */
  roleListId?: number | null;
  /** Workflow only: the role list name (for display). */
  roleListName?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  role?: string | null;
}

export interface UserRef {
  id?: number;
  loginName: string;
  name: string;
  surname: string;
}

export interface Role {
  id: number;
  name: string;
  members: UserRef[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RoleList {
  id: number;
  name: string;
  members: { id: number; name: string }[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProgressOption {
  label: string;
  value: string;
}

/** Full workflow progress descriptor served by the work area endpoints. */
export interface ProgressWorkflow {
  options: ProgressOption[];
  transitions: WorkflowTransition[];
  initialState: string | null;
}

export interface SearchRow {
  id: string;
  dbId: string;
  category: string;
  title: string;
  cells: Record<string, unknown>;
}

export const FIELD_TYPES = [
  "number",
  "date",
  "string",
  "attachment",
  "html",
  "md",
  "xml",
  "custom",
] as const;

export const FIELD_TYPE_KEYS: Record<string, string> = {
  number: "fieldType.number",
  date: "fieldType.date",
  string: "fieldType.string",
  attachment: "fieldType.attachment",
  html: "fieldType.html",
  md: "fieldType.md",
  xml: "fieldType.xml",
  custom: "fieldType.custom",
};

/** Attachment value stored on a field of type "attachment". */
export interface AttachmentValue {
  s3Key: string;
  fileName: string;
  size: number;
  contentType: string;
}
