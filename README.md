# AI 金融议会

一个四席并行的 AI 金融议会。

它会把同一个问题交给 4 个独立模型。每个模型只看到自己的工具包，输出判断、关键假设、会改变观点的触发条件和风险。主席不投票，只整理共识、分歧和少数派意见。

## 启动

```bash
cp .env.example .env
npm start
```

打开本地地址：

```text
http://localhost:4177
```

没有 API key 时会进入演示模式，方便先验证产品流程。

## 添加模型

在 `.env` 里填写 key。

在 `src/council-config.js` 里增加议员。

每个议员都可以配置 `allowedTools`。模型只能看到自己白名单内的工具结果。

当前议会默认保留 4 个真实席位：

- DeepSeek 数理风控官
- Gemini 基本面官
- Grok 逆向情绪官
- MINIMAX 2.7 宏观中国官

主席默认优先使用 NVIDIA 独立模型。没有 `NVIDIA_API_KEY` 时回退 DeepSeek。

## 数据工具

当前已接入：

- 实时行情：默认免费源，Yahoo Finance chart endpoint，失败时回退 Stooq CSV
- 财报与基本面：SEC Company Facts API
- Web research：默认免费源，DuckDuckGo HTML
- 本地金融工具：情景概率矩阵、风险登记表、仓位测算、估值一致性检查

默认 `DATA_MODE=free`。只有改成 `DATA_MODE=paid` 时，系统才会优先使用 Alpaca、Brave、Tavily。

## 产品结构

- `src/server.js` 本地服务和接口
- `src/council-engine.js` 议会编排
- `src/model-adapters.js` 多模型适配器
- `src/finance-tools.js` 金融辅助工具
- `src/data-tools.js` 行情、财报和 web research 适配器
- `public/` 前端界面

## 产品规则

- 四席彼此不可见，避免锚定
- 工具调用按席位白名单开放
- 主席只整理，不新增观点
- 少数派意见保留
- 前端只展示决策、分歧、假设和证据快照
