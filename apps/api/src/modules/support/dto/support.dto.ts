import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Lifecycle statuses an admin can set on a support conversation. */
export const SUPPORT_TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'RESOLVED',
  'CLOSED',
] as const;

export type SupportTicketStatusValue = (typeof SUPPORT_TICKET_STATUSES)[number];

/** Where a support case came from (mirrors the Prisma SupportTicketSource). */
export const SUPPORT_TICKET_SOURCES = ['LIVE_CHAT', 'PROBLEM_REPORT'] as const;

export type SupportTicketSourceValue = (typeof SUPPORT_TICKET_SOURCES)[number];

/** Hard server-side limit for one chat message (plain text). */
export const MAX_SUPPORT_MESSAGE_LENGTH = 2000;

/** Default page size for the user conversation message window. */
export const DEFAULT_MESSAGE_PAGE_SIZE = 50;

/** Same limit/shape as the wallet proof-of-payment upload
 *  (manual-payment.service.ts MAX_PROOF_DATA_URL_LENGTH): ~1.8 MB source image
 *  as a base64 data URL. Enforced in the service, never trusted from the body. */
export const MAX_ATTACHMENT_DATA_URL_LENGTH = 7_200_000;

/** Problem description gets more room than a chat message. */
export const MAX_REPORT_DESCRIPTION_LENGTH = 4000;

/** Problem categories selectable on "Report a Problem" (exact spec list). */
export const PROBLEM_REPORT_CATEGORIES = [
  'Login / Account',
  'Deposit',
  'Withdrawal',
  'Payment',
  'Game',
  'Sports',
  'Betting',
  'Live Chat',
  'Technical Issue',
  'Other',
] as const;

export type ProblemReportCategoryValue =
  (typeof PROBLEM_REPORT_CATEGORIES)[number];

/** Body of a user/admin chat message. Whitespace-only input is rejected in
 *  the service (after trimming) with a clean, user-safe error message. */
export class SendSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SUPPORT_MESSAGE_LENGTH)
  body!: string;

  /**
   * Client-generated idempotency key (UUID) for safe send retries. A retry
   * with the same key inside the same conversation returns the original
   * message instead of creating a duplicate. Optional; server-scoped by
   * (ticketId, clientRef) so a client can only collide with its own sends.
   */
  @IsOptional()
  @IsString()
  @IsUUID('4')
  clientRef?: string;
}

/** Older-history pagination for the user conversation (keyset cursor). */
export class ListSupportMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** ISO timestamp cursor — return messages created strictly BEFORE it. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;
}

/** Admin inbox filters. */
export class ListSupportTicketsQueryDto {
  @IsOptional()
  @IsIn([...SUPPORT_TICKET_STATUSES, 'ALL'])
  status?: string;

  /** Optional filter so the admin can look at Problem Reports only (or Live
   *  Chat only). Omitted / 'ALL' = every case. */
  @IsOptional()
  @IsIn([...SUPPORT_TICKET_SOURCES, 'ALL'])
  source?: string;

  /** Case-insensitive search on the user's username / email. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

export class UpdateSupportTicketStatusDto {
  @IsIn([...SUPPORT_TICKET_STATUSES])
  status!: SupportTicketStatusValue;
}

/** Assign a conversation to an authorized admin. Omitted `adminId` assigns to
 *  the calling admin; an explicit `null` unassigns. A concrete id must belong
 *  to a user holding ADMIN/SUPER_ADMIN (verified server-side). */
export class AssignSupportTicketDto {
  @IsOptional()
  @IsUUID('4')
  adminId?: string | null;
}

/* ------------------------------------------------------------------------- */
/* Problem Reports (a one-off reported problem — never merged into Live Chat) */
/* ------------------------------------------------------------------------- */

/**
 * Body of "Report a Problem" (/support/report).
 *
 * NOTE: there is deliberately NO `userId` field. The owner of a report is
 * ALWAYS the JWT-authenticated user (same rule as every other endpoint in this
 * codebase); the form shows the user id read-only for the user's own reference
 * but never sends it.
 */
export class CreateProblemReportDto {
  /** Problem category (one of the fixed spec options). */
  @IsIn([...PROBLEM_REPORT_CATEGORIES])
  category!: ProblemReportCategoryValue;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  /** The problem description (plain text only — never rendered as HTML). */
  @IsString()
  @MinLength(10)
  @MaxLength(MAX_REPORT_DESCRIPTION_LENGTH)
  body!: string;

  /** Optional screenshot as a base64 image data URL. Size + image type are
   *  validated in the service (same rule as the wallet proof upload). */
  @IsOptional()
  @IsString()
  attachmentDataUrl?: string;
}

/** "My problem reports" listing (paginated, newest first). */
export class ListMyReportsQueryDto {
  @IsOptional()
  @IsIn([...SUPPORT_TICKET_STATUSES, 'ALL'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

/** Follow-up message on an existing report thread (optional screenshot). */
export class SendReportMessageDto extends SendSupportMessageDto {
  @IsOptional()
  @IsString()
  attachmentDataUrl?: string;
}
