export type BlockType = 'event' | 'note' | 'file' | 'code';
export type RelationType = 'attached' | 'embedded';
export type BlockPriority = 'urgent' | 'high' | 'normal' | 'low';
export type BlockStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'completed';

export interface Block {
  id: string;
  type: BlockType;
  title: string | null;
  content: string | Record<string, unknown> | null; // JSON content cho Tiptap
  start_time: string | null;
  end_time: string | null;
  /** RRULE string (no DTSTART — dtstart lives in start_time), e.g. "FREQ=WEEKLY;BYDAY=MO". */
  recurrence: string | null;
  /** Occurrences excluded from the series: date-only for all-day, ISO instants for timed. */
  recurrence_exceptions: string[] | null;
  file_url: string | null;
  file_extension: string | null;
  owner_id: string | null;
  /** Priority level for triage (urgent > high > normal > low). */
  priority?: BlockPriority | null;
  /** Workflow status for tracking progress. */
  status?: BlockStatus | null;
  /** Tags/labels for categorization (stored as comma-separated string). */
  tags?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type BlockInput = Omit<Partial<Block>, 'id'> & { type: BlockType };

export interface BlockRelation {
  parent_id: string;
  child_id: string;
  relation_type: RelationType;
  /** Ordering of the child among its siblings (DB column; optional so
   *  constructed literals stay simple — the db layer defaults it to 0). */
  position?: number;
}