export function scanPreferenceSource(filename: string, source: string): string[];
export function checkPreferences(root: string): Promise<{ count: number; findings: string[] }>;
