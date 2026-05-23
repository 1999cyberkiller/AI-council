/* ──────────────────────────────────────────────────────────────────
   ERROR BOUNDARY · 防止子树异常崩掉整个模态
   ────────────────────────────────────────────────────────────────── */

import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      const fallback = this.props.fallback;
      if (typeof fallback === 'function') {
        return fallback(this.state.error, this.reset);
      }
      return (
        <div style={{
          padding: '24px 28px',
          fontFamily: "'EB Garamond', 'Noto Serif SC', serif",
          color: 'var(--ink)',
          background: 'var(--paper)',
          minHeight: 200,
        }}>
          <div style={{
            fontSize: '1.05rem',
            fontWeight: 700,
            color: 'var(--sell)',
            marginBottom: 12,
          }}>
            ⚠ 此面板渲染出错
          </div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 16 }}>
            内部组件抛出了异常，但不影响主页其他功能。可以尝试关闭此面板再重新打开。
          </div>
          <pre style={{
            fontSize: '0.74rem',
            fontFamily: "'Courier Prime', monospace",
            background: 'rgba(0,0,0,0.05)',
            border: '1px dashed var(--ink-faded)',
            padding: '10px 12px',
            color: 'var(--ink-soft)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
            margin: 0,
          }}>
            {this.state.error?.message || String(this.state.error || '未知错误')}
            {this.state.error?.stack && '\n\n' + this.state.error.stack.slice(0, 800)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
