/* ──────────────────────────────────────────────────────────────────
   SETTINGS PANEL · 编辑部配置面板
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect, useRef } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { ANALYSTS } from '../lib/prompts';

export const SettingsPanel = ({
  expanded,
  onToggle,
  models,
  apiKeys,
  onKeyChange,
  alphaKey,
  onAlphaChange,
  assignments,
  onAssignmentChange,
  modelVariants,
  onVariantChange,
  onAddCustomModel,
  onRemoveModel,
  saveStatus,
  onClearStorage,
}) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newModel, setNewModel] = useState({
    name: '',
    endpoint: '',
    modelName: '',
  });

  const submitNewModel = () => {
    if (!newModel.name || !newModel.endpoint || !newModel.modelName) return;
    onAddCustomModel({
      id: `custom-${Date.now()}`,
      name: newModel.name,
      label: newModel.modelName,
      endpoint: newModel.endpoint,
      modelName: newModel.modelName,
      custom: true,
      placeholder: 'sk-...',
      docsUrl: '',
      color: '#666',
    });
    setNewModel({ name: '', endpoint: '', modelName: '' });
    setShowAddForm(false);
  };

  if (!expanded) return null;

  // 持久化状态文案 + 颜色
  const saveStatusInfo = {
    idle:   { text: '已自动保存', color: 'var(--ink-faded)', dot: 'var(--ink-faded)' },
    saving: { text: '正在保存…',  color: 'var(--ink-soft)',  dot: 'var(--hold)' },
    saved:  { text: '✓ 已保存',   color: 'var(--buy)',       dot: 'var(--buy)' },
    error:  { text: '✗ 保存失败', color: 'var(--accent)',    dot: 'var(--accent)' },
  }[saveStatus] || { text: '', color: 'var(--ink-faded)', dot: 'var(--ink-faded)' };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onToggle}>
      <div ref={containerRef} className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="display-serif" style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
              编辑部配置
            </div>
            <div
              className="mono small-caps"
              style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', marginTop: 4 }}
            >
              EDITORIAL SETUP · MODELS &amp; DATA
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 自动保存状态指示器 */}
            <div
              className="mono"
              style={{
                fontSize: '0.7rem',
                color: saveStatusInfo.color,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                letterSpacing: '0.06em',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: saveStatusInfo.dot,
                  display: 'inline-block',
                  animation: saveStatus === 'saving' ? 'pulseDot 1.2s ease-in-out infinite' : 'none',
                }}
              />
              {saveStatusInfo.text}
            </div>
            <button className="modal-close" onClick={onToggle} aria-label="关闭">×</button>
          </div>
        </div>
        <div className="modal-body">
          {/* Section: Model API Keys */}
          <div style={{ marginBottom: 24 }}>
            <div
              className="small-caps mono"
              style={{
                fontSize: '0.72rem',
                color: 'var(--ink-soft)',
                marginBottom: 12,
                paddingBottom: 6,
                borderBottom: '1px solid var(--ink-faded)',
              }}
            >
              ◆ MODEL API KEYS · 模 型 接 入 凭 据
            </div>
            <div
              className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4"
              style={{ marginBottom: 12 }}
            >
              {models.map((m) => (
                <div key={m.id}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                    <label
                      className="display-serif"
                      style={{ fontSize: '0.95rem', fontWeight: 600 }}
                    >
                      {m.name}{' '}
                      {m.custom ? (
                        <span
                          className="mono"
                          style={{ fontSize: '0.7rem', color: 'var(--ink-faded)', letterSpacing: '0.05em' }}
                        >
                          · {m.modelName}
                        </span>
                      ) : null}
                    </label>
                    {m.custom && (
                      <button
                        onClick={() => onRemoveModel(m.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent)',
                          cursor: 'pointer',
                          fontSize: '0.7rem',
                          fontFamily: "'Courier Prime', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace",
                          letterSpacing: '0.1em',
                        }}
                      >
                        REMOVE
                      </button>
                    )}
                  </div>

                  {/* 内置模型才显示变体下拉 */}
                  {!m.custom && Array.isArray(m.variants) && m.variants.length > 0 && (
                    <select
                      className="model-select"
                      style={{ width: '100%', marginBottom: 6 }}
                      value={modelVariants[m.id] || m.defaultVariant || m.variants[0].id}
                      onChange={(e) => onVariantChange(m.id, e.target.value)}
                    >
                      {m.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}{v.reasoning ? ' · 推理模型' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    type="password"
                    className="key-input"
                    placeholder={m.placeholder}
                    value={apiKeys[m.id] || ''}
                    onChange={(e) => onKeyChange(m.id, e.target.value)}
                  />
                  {m.docsUrl && (
                    <div
                      className="mono"
                      style={{ fontSize: '0.65rem', color: 'var(--ink-faded)', marginTop: 3 }}
                    >
                      申请：{m.docsUrl}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!showAddForm ? (
              <button
                className="btn-ghost"
                onClick={() => setShowAddForm(true)}
                style={{ marginTop: 4 }}
              >
                + 添加自定义模型 (OpenAI 兼容)
              </button>
            ) : (
              <div
                style={{
                  padding: 14,
                  border: '1px dashed var(--ink-faded)',
                  background: 'rgba(0,0,0,0.02)',
                }}
              >
                <div
                  className="mono small-caps"
                  style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginBottom: 10 }}
                >
                  + 新增自定义模型 · OpenAI 兼容协议
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3" style={{ marginBottom: 10 }}>
                  <input
                    className="key-input"
                    placeholder="显示名称（如 Qwen）"
                    value={newModel.name}
                    onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                  />
                  <input
                    className="key-input"
                    placeholder="API 端点（如 https://.../v1/chat/completions）"
                    value={newModel.endpoint}
                    onChange={(e) => setNewModel({ ...newModel, endpoint: e.target.value })}
                  />
                  <input
                    className="key-input"
                    placeholder="模型名（如 qwen-plus）"
                    value={newModel.modelName}
                    onChange={(e) => setNewModel({ ...newModel, modelName: e.target.value })}
                  />
                </div>
                <div className="flex gap-3">
                  <button className="btn-ghost" onClick={submitNewModel}>
                    确认添加
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewModel({ name: '', endpoint: '', modelName: '' });
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section: Analyst-Model Assignment */}
          <div style={{ marginBottom: 24 }}>
            <div
              className="small-caps mono"
              style={{
                fontSize: '0.72rem',
                color: 'var(--ink-soft)',
                marginBottom: 12,
                paddingBottom: 6,
                borderBottom: '1px solid var(--ink-faded)',
              }}
            >
              ◆ COLUMNIST DESK ASSIGNMENT · 专 栏 与 模 型 配 对
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {ANALYSTS.map((a) => (
                <div key={a.id} className="data-card" style={{ padding: '10px 12px' }}>
                  <div className="display-serif" style={{ fontSize: '1rem', fontWeight: 700 }}>
                    {a.cnName}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: '0.62rem',
                      color: 'var(--ink-faded)',
                      letterSpacing: '0.06em',
                      marginBottom: 6,
                    }}
                  >
                    {a.enName}
                  </div>
                  <select
                    className="model-select"
                    style={{ width: '100%' }}
                    value={assignments[a.id] || ''}
                    onChange={(e) => onAssignmentChange(a.id, e.target.value)}
                  >
                    <option value="">— 未分配 —</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Editor-in-Chief assignment */}
            <div
              className="data-card"
              style={{
                marginTop: 14,
                padding: '12px 14px',
                background: 'rgba(139, 45, 31, 0.06)',
                borderColor: 'var(--accent)',
              }}
            >
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div
                    className="display-serif"
                    style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent)' }}
                  >
                    ◆ 主 编 · Editor-in-Chief
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: '0.68rem', color: 'var(--ink-faded)', marginTop: 3, letterSpacing: '0.06em' }}
                  >
                    四篇专栏完成后，由主编综合裁决
                  </div>
                </div>
                <select
                  className="model-select"
                  style={{ minWidth: 160 }}
                  value={assignments.editor || ''}
                  onChange={(e) => onAssignmentChange('editor', e.target.value)}
                >
                  <option value="">— 不启用主编 —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section: Financial Data */}
          <div>
            <div
              className="small-caps mono"
              style={{
                fontSize: '0.72rem',
                color: 'var(--ink-soft)',
                marginBottom: 12,
                paddingBottom: 6,
                borderBottom: '1px solid var(--ink-faded)',
              }}
            >
              ◆ FINANCIAL DATA · 行 情 数 据 源
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <label
                  className="display-serif"
                  style={{ fontSize: '0.95rem', fontWeight: 600, display: 'block', marginBottom: 5 }}
                >
                  东方财富（A 股）
                  <span
                    className="mono"
                    style={{ fontSize: '0.7rem', color: 'var(--buy)', marginLeft: 8, letterSpacing: '0.05em' }}
                  >
                    · 已就绪
                  </span>
                </label>
                <div
                  className="mono"
                  style={{ fontSize: '0.74rem', color: 'var(--ink-faded)', lineHeight: 1.6 }}
                >
                  无需 key · 提供实时行情、市值、PE/PB、52 周区间
                </div>
              </div>
              <div>
                <label
                  className="display-serif"
                  style={{ fontSize: '0.95rem', fontWeight: 600, display: 'block', marginBottom: 5 }}
                >
                  Alpha Vantage（美股）
                  <span
                    className="mono"
                    style={{
                      fontSize: '0.7rem',
                      color: alphaKey ? 'var(--buy)' : 'var(--ink-faded)',
                      marginLeft: 8,
                      letterSpacing: '0.05em',
                    }}
                  >
                    · {alphaKey ? '已配置' : '需要 key'}
                  </span>
                </label>
                <input
                  type="password"
                  className="key-input"
                  placeholder="Alpha Vantage API Key"
                  value={alphaKey}
                  onChange={(e) => onAlphaChange(e.target.value)}
                />
                <div
                  className="mono"
                  style={{ fontSize: '0.65rem', color: 'var(--ink-faded)', marginTop: 3 }}
                >
                  免费申请：alphavantage.co/support/#api-key
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              padding: '12px 14px',
              background: 'rgba(139, 45, 31, 0.06)',
              borderLeft: '3px solid var(--accent)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              className="body-serif"
              style={{
                fontSize: '0.74rem',
                color: 'var(--ink-faded)',
                lineHeight: 1.55,
              }}
            >
              ※ 配置数据（API key + 自定义模型 + 分配关系）已自动持久化，下次打开页面无需重新输入。
              数据按用户私密保存，不会泄露给他人；但仍建议**仅使用低额度或独立的测试 key**，不要在公共设备上输入生产环境凭据。
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClearStorage}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--accent)',
                  color: 'var(--accent)',
                  padding: '5px 14px',
                  fontFamily: "'Courier Prime', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace",
                  fontSize: '0.72rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent)';
                  e.currentTarget.style.color = 'var(--paper)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--accent)';
                }}
              >
                清除所有已存储凭据
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
