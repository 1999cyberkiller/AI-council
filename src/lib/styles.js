/* ──────────────────────────────────────────────────────────────────
   SHARED INLINE STYLE CONSTANTS · 高频复用，避免每次 render 重新构建
   ────────────────────────────────────────────────────────────────── */

export const STY_RETRY_BTN_BASE = {
  background: 'transparent',
  border: '1px solid var(--accent)',
  color: 'var(--accent)',
  padding: '4px 14px',
  fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
  fontSize: '0.72rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'all 0.18s',
};

export const STY_ERR_LINE = {
  marginTop: 8,
  fontSize: '0.74rem',
  wordBreak: 'break-word',
};

export const STY_ERR_RAW = {
  marginTop: 6,
  padding: '8px 10px',
  background: 'rgba(0,0,0,0.04)',
  border: '1px dashed var(--ink-faded)',
  fontFamily: "'Courier Prime', monospace",
  fontSize: '0.7rem',
  color: 'var(--ink-soft)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 160,
  overflow: 'auto',
  margin: 0,
};

export const STY_DISCLOSURE_BTN = {
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-faded)',
  fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
  fontSize: '0.66rem',
  letterSpacing: '0.1em',
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'underline dotted',
};

export const STY_TOAST = {
  position: 'fixed',
  top: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  padding: '10px 22px',
  fontFamily: "'Fraunces', 'Noto Serif SC', serif",
  fontSize: '0.92rem',
  boxShadow: '4px 4px 0 var(--accent)',
  border: '1px solid var(--ink)',
  zIndex: 300,
  maxWidth: '90vw',
};
