export interface UpdateState {
  version: string;
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'confirming' | 'downloading' | 'installing' | 'error';
  latestVersion?: string;
  message?: string;
}
