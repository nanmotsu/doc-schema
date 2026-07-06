// 2xx 以外をエラーにする小さな fetch ヘルパー。
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${url}`);
  }
  return res.json();
}

// JSONをPOSTしてレスポンスを返すヘルパー。
async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(body?.error || `Request failed: ${url}`);
  }
  return body;
}

let pipelineMeta = null;
let selectedRunId = "__new__";
const selectedOutputByStep = new Map();
let refreshTimerId = null;

// HTMLに安全に表示するため最小限のエスケープを行う。
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 実行済みログ数と総ステップ数から進捗率を計算する。
function computeProgress(runtime) {
  if (!runtime || !pipelineMeta) {
    return { percent: 0, label: "進捗: 0%" };
  }

  const completed = (runtime.logs || []).filter((log) => log.phase === "completed").length;
  const loopCount = Number(runtime?.variables?.loopCount || 1);
  const total = pipelineMeta.steps.reduce((sum, step) => sum + (step.hasLoop ? loopCount : 1), 0);
  const boundedTotal = Math.max(total, 1);
  const percent = Math.min(100, Math.round((completed / boundedTotal) * 100));
  const currentStep = runtime.currentStepId || "-";
  const currentIteration = Number.isInteger(runtime.currentIteration) ? runtime.currentIteration : 0;
  return {
    percent,
    label: `進捗: ${percent}% / 現在: ${currentStep} (${currentIteration})`
  };
}

// 出力パスのテンプレートを正規表現へ変換する（{{...}} は1セグメント扱い）。
function pathTemplateToRegex(templatePath) {
  const escaped = templatePath
    .replaceAll("\\", "/")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{\\\{[^}]+\\\}\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

// APIが返す相対パスを project の output 基準に正規化する。
function toProjectOutputPath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  return normalized.startsWith("output/") ? normalized : `output/${normalized}`;
}

// ステップ定義と実ファイル一覧から選択可能な出力候補を作る。
function resolveStepOutputCandidates(stepMeta, outputFiles) {
  if (!stepMeta?.outputs?.length) {
    return [];
  }

  const candidates = [];
  for (const outputSpec of stepMeta.outputs) {
    const pattern = outputSpec.path.replaceAll("\\", "/");
    if (!pattern.includes("{{")) {
      const exact = outputFiles.find((file) => {
        return file === pattern || toProjectOutputPath(file) === pattern;
      });
      if (exact) {
        candidates.push({ path: exact, label: `${outputSpec.name}: ${toProjectOutputPath(exact)}` });
      }
      continue;
    }

    const rx = pathTemplateToRegex(pattern);
    const matched = outputFiles
      .filter((file) => rx.test(file) || rx.test(toProjectOutputPath(file)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of matched) {
      candidates.push({ path: file, label: `${outputSpec.name}: ${toProjectOutputPath(file)}` });
    }
  }

  const seen = new Set();
  return candidates.filter((item) => {
    if (seen.has(item.path)) {
      return false;
    }
    seen.add(item.path);
    return true;
  });
}

// ステップに必要な出力が、実ファイルとして十分揃っているか判定する。
function hasRequiredOutputsForStep(stepMeta, outputFiles, expectedCount) {
  const outputs = stepMeta?.outputs || [];
  if (!outputs.length) {
    return false;
  }

  return outputs.every((outputSpec) => {
    const pattern = outputSpec.path.replaceAll("\\", "/");

    if (!pattern.includes("{{")) {
      return outputFiles.some((file) => file === pattern || toProjectOutputPath(file) === pattern);
    }

    const rx = pathTemplateToRegex(pattern);
    const matched = outputFiles.filter((file) => rx.test(file) || rx.test(toProjectOutputPath(file)));
    return matched.length >= Math.max(1, expectedCount);
  });
}

// ドロップダウン選択中のrunIdに応じて表示対象のruntimeを決定する。
function pickDisplayRuntime(latestRuntime, runs) {
  if (selectedRunId === "__new__") {
    return latestRuntime;
  }
  return runs.find((run) => run.runId === selectedRunId) || latestRuntime;
}

function effectiveSnapshotRunId() {
  return selectedRunId === "__new__" ? "" : selectedRunId;
}

// runIdセレクタを更新する。
function renderRunSelector(latestRuntime, runs) {
  const select = document.getElementById("runIdSelect");
  if (!select) {
    return;
  }

  const options = [{ value: "__new__", label: "新規実行" }]
    .concat(runs.map((run) => ({ value: run.runId, label: `${run.runId} (${run.phase})` })));

  const before = selectedRunId;
  select.innerHTML = options
    .map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
    .join("");

  const validValues = new Set(options.map((o) => o.value));
  if (!validValues.has(before)) {
    selectedRunId = "__new__";
  }
  select.value = selectedRunId;

  if (!select.dataset.bound) {
    select.addEventListener("change", () => {
      selectedRunId = select.value;
      void refreshAll();
    });
    select.dataset.bound = "1";
  }
}

// runId を含めた選択キーを作り、別run間の選択状態が混ざらないようにする。
function outputSelectionKey(stepId) {
  return `${selectedRunId}::${stepId}`;
}

// fromStepより前に必要な出力が揃っているかを確認する。
function findMissingPrerequisites(fromStepId, outputFiles) {
  const steps = pipelineMeta?.steps || [];
  const fromIndex = steps.findIndex((step) => step.id === fromStepId);
  if (fromIndex < 0) {
    return [`開始ステップID '${fromStepId}' が見つかりません。`];
  }
  if (fromIndex === 0) {
    return [];
  }

  const missing = [];
  for (const step of steps.slice(0, fromIndex)) {
    const candidates = resolveStepOutputCandidates(step, outputFiles);
    if (!candidates.length) {
      const desc = (step.outputs || []).map((o) => `${step.id}.${o.name} (${o.path})`).join(", ");
      missing.push(desc || step.id);
    }
  }

  return missing;
}

// 出力内容モーダルを開く。
function openOutputModal(titlePath, content) {
  const modal = document.getElementById("outputModal");
  const pathNode = document.getElementById("outputModalPath");
  const contentNode = document.getElementById("outputModalContent");
  if (!modal || !pathNode || !contentNode) {
    return;
  }

  pathNode.textContent = titlePath;
  contentNode.textContent = content;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

// 出力内容モーダルを閉じる。
function closeOutputModal() {
  const modal = document.getElementById("outputModal");
  if (!modal) {
    return;
  }
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

// モーダルのイベントを初期化する。
function setupOutputModal() {
  const closeBtn = document.getElementById("closeOutputModalBtn");
  const backdrop = document.getElementById("outputModalBackdrop");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeOutputModal();
    });
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => {
      closeOutputModal();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeOutputModal();
    }
  });
}

// プログレスバー表示を更新する。
function renderProgress(runtime, control) {
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const { percent, label } = computeProgress(runtime);
  progressBar.style.width = `${percent}%`;
  progressText.textContent = label;

  if (control?.isRunning && percent < 100) {
    progressBar.classList.add("running");
  } else {
    progressBar.classList.remove("running");
  }
}

// 実行ボタン群のイベントを初期化する。
function setupRunControls() {
  const liveBtn = document.getElementById("runLiveBtn");
  const dryBtn = document.getElementById("runDryBtn");
  const cancelBtn = document.getElementById("cancelRunBtn");
  const fromStepInput = document.getElementById("fromStepId");
  const runStatus = document.getElementById("runStatus");

  async function startRun(dryRun) {
    liveBtn.disabled = true;
    dryBtn.disabled = true;
    runStatus.textContent = dryRun ? "Dry Run 実行中..." : "実行中...";

    try {
      const fromStepId = fromStepInput.value.trim() || undefined;

      if (fromStepId) {
        const outputFiles = await getJson(`/api/outputs?runId=${encodeURIComponent(effectiveSnapshotRunId())}`);
        const missing = findMissingPrerequisites(fromStepId, outputFiles);
        if (missing.length > 0) {
          window.alert(
            "fromStepId より前の出力が不足しているため実行できません。\n"
            + missing.map((item) => `- ${item}`).join("\n")
          );
          runStatus.textContent = "不足出力のため実行を中止しました。";
          return;
        }
      }

      const payload = {
        dryRun,
        fromStepId,
        sourceRunId: effectiveSnapshotRunId() || undefined
      };

      if (effectiveSnapshotRunId()) {
        const confirmed = window.confirm("過去スナップショットを使って再実行します。output を一掃し、必要な出力を復元して上書きします。続行しますか？");
        if (!confirmed) {
          runStatus.textContent = "再実行をキャンセルしました。";
          return;
        }
      }

      const result = await postJson("/api/run", payload);
      runStatus.textContent = result.message || "実行を開始しました。";
      await refreshAll();
    } catch (error) {
      runStatus.textContent = `失敗: ${String(error.message || error)}`;
    } finally {
      liveBtn.disabled = false;
      dryBtn.disabled = false;
    }
  }

  liveBtn.addEventListener("click", () => startRun(false));
  dryBtn.addEventListener("click", () => startRun(true));

  cancelBtn.addEventListener("click", async () => {
    try {
      const result = await postJson("/api/cancel", {});
      runStatus.textContent = result.message || "キャンセル要求を送信しました。";
    } catch (error) {
      runStatus.textContent = `失敗: ${String(error.message || error)}`;
    }
  });
}

// 現在の実行状態カードを描画する。
function renderRuntime(runtime) {
  const root = document.getElementById("runtime");
  if (!runtime) {
    root.innerHTML = "<div class='item'>実行情報がありません。</div>";
    return;
  }

  const phaseClass = runtime.phase || "idle";
  root.innerHTML = `
    <div class="item"><span class="label">runId</span><span class="value">${runtime.runId ?? "-"}</span></div>
    <div class="item"><span class="label">phase</span><span class="value"><span class="badge ${phaseClass}">${runtime.phase}</span></span></div>
    <div class="item"><span class="label">current</span><span class="value">${runtime.currentStepId ?? "-"} (#${runtime.currentIteration ?? 0})</span></div>
    <div class="item"><span class="label">dryRun</span><span class="value">${runtime.dryRun ? "true" : "false"}</span></div>
    <div class="item"><span class="label">adminMode</span><span class="value">${runtime.adminMode ? "true" : "false"}</span></div>
    <div class="item"><span class="label">from</span><span class="value">${runtime.fromStepId ?? "-"}</span></div>
  `;
}

// ステップ順に done/running/waiting を縦表示する。
function renderStepTable(runtime, control, outputFiles) {
  const root = document.getElementById("stepTableBody");
  const steps = pipelineMeta?.steps || [];

  if (!root) {
    return;
  }
  if (!steps.length) {
    root.innerHTML = "<tr><td colspan='6'>pipeline 定義を取得できませんでした。</td></tr>";
    return;
  }

  const logs = runtime?.logs || [];
  const completedByStep = new Map();
  for (const log of logs) {
    if (log.phase !== "completed") {
      continue;
    }
    completedByStep.set(log.stepId, (completedByStep.get(log.stepId) || 0) + 1);
  }

  const loopCount = Math.max(1, Number(runtime?.variables?.loopCount || 1));
  const currentStepId = runtime?.currentStepId;
  const currentIteration = Number.isInteger(runtime?.currentIteration) ? runtime.currentIteration : null;
  const isRunning = Boolean(control?.isRunning);
  root.innerHTML = steps.map((step, index) => {
    const expected = step.hasLoop ? loopCount : 1;
    const completed = Number(completedByStep.get(step.id) || 0);
    const isCurrent = isRunning && currentStepId === step.id;
    const hasRequiredOutputs = hasRequiredOutputsForStep(step, outputFiles, expected);

    let status = "waiting";
    if (runtime?.phase === "failed" && currentStepId === step.id) {
      status = "failed";
    } else if (runtime?.phase === "cancelled" && currentStepId === step.id) {
      status = "cancelled";
    } else if (isCurrent) {
      status = "running";
    } else if (completed >= expected) {
      status = "done";
    } else if (hasRequiredOutputs) {
      // fromStep実行時に流用された出力があるステップは done 扱いにする。
      status = "done";
    }

    const iterationText = isCurrent && currentIteration !== null ? String(currentIteration) : "-";
    const outputCandidates = resolveStepOutputCandidates(step, outputFiles);
    const selectionKey = outputSelectionKey(step.id);
    const selectedCandidate = selectedOutputByStep.get(selectionKey);
    const selected = outputCandidates.some((item) => item.path === selectedCandidate)
      ? selectedCandidate
      : (outputCandidates[0]?.path || "");
    const canSelectOutput = status === "done" && outputCandidates.length > 0;

    const outputCell = canSelectOutput
      ? `<div class="step-output-buttons">${outputCandidates
        .map((item) => {
          const isSelected = item.path === selected;
          const encodedPath = encodeURIComponent(item.path);
          return `<button class="step-output-btn ${isSelected ? "is-selected" : ""}" data-step-id="${escapeHtml(step.id)}" data-path="${encodedPath}">${escapeHtml(item.label)}</button>`;
        })
        .join("")}</div>`
      : (status === "done" ? "<span class='muted'>出力なし</span>" : "<span class='muted'>waiting</span>");

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(step.id)}</td>
        <td><span class="badge ${status}">${status}</span></td>
        <td>${completed} / ${expected}</td>
        <td>${iterationText}</td>
        <td>${outputCell}</td>
      </tr>
    `;
  }).join("");

  root.querySelectorAll(".step-output-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const stepId = button.getAttribute("data-step-id") || "";
      const encodedPath = button.getAttribute("data-path") || "";
      const filePath = decodeURIComponent(encodedPath);
      if (!stepId || !filePath) {
        return;
      }

      selectedOutputByStep.set(outputSelectionKey(stepId), filePath);
      await loadOutputContent(filePath);
      void refreshAll();
    });
  });
}

// 選択した出力ファイル本文を取得してモーダル表示する。
async function loadOutputContent(relativePath) {
  if (!relativePath) {
    return;
  }

  try {
    const payload = await getJson(
      `/api/output?path=${encodeURIComponent(relativePath)}&runId=${encodeURIComponent(effectiveSnapshotRunId())}`
    );
    openOutputModal(relativePath, payload.content);
  } catch (error) {
    openOutputModal(relativePath, `出力の読み込みに失敗しました: ${String(error.message || error)}`);
  }
}

// ダッシュボード各セクションを並列で更新する。
async function refreshAll() {
  try {
    const [runtimeLatest, runs, outputs, control] = await Promise.all([
      getJson("/api/runtime"),
      getJson("/api/runs"),
        getJson(`/api/outputs?runId=${encodeURIComponent(effectiveSnapshotRunId())}`),
      getJson("/api/control")
    ]);

    renderRunSelector(runtimeLatest, runs);
    const runtime = pickDisplayRuntime(runtimeLatest, runs);
    const displayControl = selectedRunId === "__new__"
      ? control
      : { isRunning: false, cancelRequested: false };

    renderRuntime(runtime);
    renderStepTable(runtime, displayControl, outputs);
    renderProgress(runtime, displayControl);

    const cancelBtn = document.getElementById("cancelRunBtn");
    if (cancelBtn) {
      cancelBtn.disabled = !control?.isRunning;
    }
  } catch (error) {
    document.getElementById("runtime").textContent = String(error);
  }
}

// 初回読み込みと定期ポーリング。
function startRefreshLoop() {
  if (refreshTimerId !== null) {
    clearInterval(refreshTimerId);
  }

  const rawInterval = Number(pipelineMeta?.progressPollMs ?? 3000);
  const intervalMs = Number.isFinite(rawInterval) && rawInterval > 0 ? Math.floor(rawInterval) : 3000;
  refreshTimerId = setInterval(refreshAll, intervalMs);
}

getJson("/api/pipeline").then((meta) => {
  pipelineMeta = meta;
}).catch(() => {
  pipelineMeta = { steps: [], progressPollMs: 3000 };
}).finally(() => {
  setupRunControls();
  setupOutputModal();
  refreshAll();
  startRefreshLoop();
});
