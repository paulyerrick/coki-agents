interface IconProps { size: number }

// ── Brand-specific shapes ─────────────────────────────────────────────────────

function OutlookIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0078D4"/>
      {/* Envelope body */}
      <rect x="6" y="10" width="20" height="14" rx="2" fill="white"/>
      {/* Envelope flap V */}
      <path d="M6 12l10 7 10-7" stroke="#0078D4" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

function GmailIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#EA4335"/>
      {/* Envelope body */}
      <rect x="6" y="10" width="20" height="14" rx="2" fill="white"/>
      {/* M-shape flap */}
      <path d="M6 12l5 4 5-3 5 3 5-4" stroke="#EA4335" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TelegramIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#2CA5E0"/>
      {/* Paper plane */}
      <path d="M7 15.8L24 9l-4 14-4.5-3.5-2.5 2.5V18L7 15.8z" fill="white"/>
      {/* Fold crease */}
      <path d="M13 18l7-7" stroke="#2CA5E0" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function SlackIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#4A154B"/>
      {/* Simplified bolt/S shape */}
      <path
        d="M20 8h-6a2 2 0 000 4h6a2 2 0 000-4zM12 13h8v2h-8zM12 17h6a2 2 0 010 4H12a2 2 0 010-4z"
        fill="white"
      />
    </svg>
  );
}

function WhatsAppIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#25D366"/>
      {/* Speech bubble */}
      <path
        d="M16 8a8 8 0 016.5 12.7L24 24l-3.4-1A8 8 0 1116 8z"
        fill="white"
      />
      {/* Phone handset */}
      <path
        d="M13 13.5c.2-.4.8-.5 1.1-.1l.7 1c.2.3.1.6-.1.8l-.3.3c.3.7 1.4 1.8 2.1 2.1l.3-.3c.2-.2.6-.3.8-.1l1 .7c.4.3.3.9-.1 1.1-.9.6-2.1.5-3.1-.2a9 9 0 01-2.8-2.8c-.7-1-.8-2.2-.2-3.1z"
        fill="#25D366"
      />
    </svg>
  );
}

function PlanningCenterIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1E7B9A"/>
      {/* Stylized people/church: roof triangle + two people dots */}
      <path d="M16 8L23 15H9L16 8z" fill="white"/>
      <rect x="10" y="15" width="12" height="9" rx="1" fill="white"/>
      <rect x="14" y="18" width="4" height="6" rx="1" fill="#1E7B9A"/>
    </svg>
  );
}

function MondayIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#FF3D57"/>
      {/* Three status circles */}
      <circle cx="10" cy="16" r="3.5" fill="white"/>
      <circle cx="18" cy="16" r="3.5" fill="white" opacity="0.7"/>
      <circle cx="26" cy="16" r="3.5" fill="white" opacity="0.4"/>
    </svg>
  );
}

function ClaudeIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#D4570E"/>
      {/* A letterform */}
      <path d="M16 8l7 16h-3l-1.5-4h-5L12 24H9L16 8z" fill="white"/>
      <path d="M13.5 17h5l-2.5-6-2.5 6z" fill="#D4570E"/>
    </svg>
  );
}

function CalendarIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0078D4"/>
      <rect x="6" y="9" width="20" height="16" rx="2" fill="white"/>
      <rect x="6" y="9" width="20" height="6" rx="2" fill="#0078D4"/>
      {/* Tick marks */}
      <line x1="11" y1="7" x2="11" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      <line x1="21" y1="7" x2="21" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      {/* Grid dots */}
      <rect x="9" y="19" width="3" height="2" rx="0.5" fill="#0078D4"/>
      <rect x="14.5" y="19" width="3" height="2" rx="0.5" fill="#0078D4"/>
      <rect x="20" y="19" width="3" height="2" rx="0.5" fill="#0078D4"/>
    </svg>
  );
}

function SupabaseIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#3ECF8E"/>
      {/* Lightning bolt */}
      <path d="M19 7l-8 11h7l-5 7 10-13h-7L19 7z" fill="white"/>
    </svg>
  );
}

// ── Fallback: colored square with first letter ─────────────────────────────────

const FALLBACK_COLORS: Record<string, string> = {
  twilio:  '#F22F46',
  sms:     '#F22F46',
  discord: '#5865F2',
  asana:   '#F06A6A',
  monday:  '#FF3D57',
  email:   '#0078D4',
};

function FallbackIcon({ service, size }: { service: string; size: number }) {
  const letter = (service[0] ?? '?').toUpperCase();
  const color = FALLBACK_COLORS[service] ?? '#6B7280';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill={color}/>
      <text
        x="16" y="21"
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="700"
        fontFamily="system-ui,sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface ServiceIconProps {
  service: string;
  size?: number;
}

export function ServiceIcon({ service, size = 32 }: ServiceIconProps) {
  switch (service) {
    case 'outlook':
    case 'microsoft':
      return <OutlookIcon size={size}/>;
    case 'gmail':
    case 'google':
      return <GmailIcon size={size}/>;
    case 'nylas_email':
    case 'email':
      return <OutlookIcon size={size}/>;  // generic email = envelope
    case 'nylas_calendar':
    case 'calendar':
      return <CalendarIcon size={size}/>;
    case 'telegram':
      return <TelegramIcon size={size}/>;
    case 'slack':
      return <SlackIcon size={size}/>;
    case 'whatsapp':
      return <WhatsAppIcon size={size}/>;
    case 'planning_center':
      return <PlanningCenterIcon size={size}/>;
    case 'monday':
      return <MondayIcon size={size}/>;
    case 'anthropic':
    case 'claude':
      return <ClaudeIcon size={size}/>;
    case 'supabase':
      return <SupabaseIcon size={size}/>;
    default:
      return <FallbackIcon service={service} size={size}/>;
  }
}
