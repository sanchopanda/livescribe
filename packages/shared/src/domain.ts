export interface UserDTO { id: string; email: string; name: string | null; }
export interface AuthResponse { user: UserDTO; }
export interface LoginRequest { email: string; password: string; }
export interface RegisterRequest { email: string; password: string; name?: string; }

export interface TranscriptSegmentDTO {
  id: string; speaker: string | null; text: string; tsMs: number; confidence: number | null;
}
export interface ActionItem { text: string; owner?: string; }
export interface AnalysisDTO { summary: string | null; actionItems: ActionItem[] | null; createdAt?: string | null; }
export interface MeetingDTO {
  id: string; platform: string | null; title: string | null; audioMode: string | null;
  startedAt: string; endedAt: string | null; durationSec: number | null; participantsCount: number | null;
}
export interface MeetingDetailDTO extends MeetingDTO {
  segments: TranscriptSegmentDTO[]; analysis: AnalysisDTO | null;
}
export interface PersonalTokenDTO {
  id: string; label: string | null; createdAt: string; lastUsedAt: string | null; token?: string;
}
export interface LiveSummaryDTO { bullets: string[]; }
