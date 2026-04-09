/**
 * Available ElevenLabs voices for the COKI Agents briefing.
 * Users can select their preferred voice in Settings.
 */

export interface BriefingVoice {
  id: string;
  name: string;
  description: string;
}

/** Platform default voice (used when no voice is set in briefing_settings). */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/** Curated list of available voices users can choose from. */
export const AVAILABLE_VOICES: BriefingVoice[] = [
  { id: '56AoDkrOh6qfVPDXZ7Pt', name: 'Donna',  description: 'Professional, warm, direct' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  description: 'Friendly and approachable' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Clear and articulate' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Strong and confident' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   description: 'Deep and authoritative' },
];
