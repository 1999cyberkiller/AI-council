/* ──────────────────────────────────────────────────────────────────
   SHARED HOOKS
   - useConfirm:      替代 native confirm()，返回 [confirm, dialog]
   - useEscToClose:   监听 Esc 关闭模态
   - useFocusTrap:    模态层 focus 不外逃
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect } from 'react';

export function useConfirm() {
  const [state, setState] = useState(null); // null | { message, resolve, danger, title }

  const confirm = (message, opts = {}) => {
    return new Promise((resolve) => {
      setState({ message, resolve, danger: !!opts.danger, title: opts.title });
    });
  };

  const handleClose = (result) => {
    if (state?.resolve) state.resolve(result);
    setState(null);
  };

  // Esc / Enter 键支持
  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose(false);
      if (e.key === 'Enter') handleClose(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const dialog = state ? (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-msg"
      onClick={() => handleClose(false)}
      style={{ zIndex: 200 }}
    >
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <div className="modal-header">
          <div>
            <div className="display-serif" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
              {state.title || (state.danger ? '请再确认' : '请确认')}
            </div>
          </div>
          <button className="modal-close" onClick={() => handleClose(false)} aria-label="取消">×</button>
        </div>
        <div className="modal-body" style={{ paddingBottom: 18 }}>
          <div
            id="confirm-msg"
            className="body-serif"
            style={{ fontSize: '0.96rem', lineHeight: 1.6, color: 'var(--ink)', marginBottom: 22 }}
          >
            {state.message}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => handleClose(false)}
              style={{
                background: 'transparent',
                border: '1px solid var(--ink-faded)',
                color: 'var(--ink-soft)',
                padding: '7px 18px',
                fontFamily: "'Fraunces', 'Noto Serif SC', serif",
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
              autoFocus
            >
              取消
            </button>
            <button
              onClick={() => handleClose(true)}
              style={{
                background: state.danger ? 'var(--accent)' : 'var(--ink)',
                color: 'var(--paper)',
                border: `1px solid ${state.danger ? 'var(--accent)' : 'var(--ink)'}`,
                padding: '7px 18px',
                fontFamily: "'Fraunces', 'Noto Serif SC', serif",
                fontSize: '0.9rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {state.danger ? '确认' : '好'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, dialog];
}

export function useEscToClose(isOpen, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
}

/**
 * 模态焦点陷阱
 * - 传入 ref 指向 modal-container
 * - 打开时第一个可聚焦元素自动获得焦点
 * - Tab / Shift+Tab 在边界循环
 * - 关闭后恢复打开前的焦点
 */
export function useFocusTrap(isOpen, containerRef) {
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const container = containerRef.current;

    const previouslyFocused = document.activeElement;

    const focusables = () =>
      Array.from(
        container.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

    const list = focusables();
    if (list.length > 0) {
      const firstNonClose = list.find((el) => !el.classList?.contains('modal-close')) || list[0];
      try { firstNonClose.focus(); } catch {}
    }

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) {
        e.preventDefault();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      if (previouslyFocused && previouslyFocused.focus) {
        try { previouslyFocused.focus(); } catch {}
      }
    };
  }, [isOpen, containerRef]);
}
