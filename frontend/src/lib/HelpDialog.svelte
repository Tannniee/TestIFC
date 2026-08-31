<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { CopyText, HelpTopic } from "./i18n";

  export let text: CopyText;
  export let version: string;
  export let topics: HelpTopic[];
  export let selectedTopic: number;
  export let onSelectTopic: (index: number) => void;
  export let onClose: () => void;

  let dialog: HTMLDivElement;
  let closeButton: HTMLButtonElement;
  let previousFocus: HTMLElement | null = null;
  $: topic = topics[selectedTopic] ?? topics[0];

  onMount(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => closeButton?.focus());
    return () => previousFocus?.focus();
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<div class="dialog-backdrop" role="presentation" onclick={handleBackdrop}>
  <div bind:this={dialog} class="qn-dialog qn-dialog-lg help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <header class="qn-dialog__header">
      <h2 id="help-title">{text.helpTitle} · v{version}</h2>
      <button bind:this={closeButton} class="qn-dialog__close" aria-label={text.closeDialog} onclick={onClose}>×</button>
    </header>
    <div class="qn-help">
      <nav class="qn-help__nav" aria-label={text.topics}>
        {#each topics as item, index}
          {#if index === 0 || item.group !== topics[index - 1].group}<h4 class="qn-help__heading">{item.group}</h4>{/if}
          <button class:qn-help__topic--active={selectedTopic === index} class="qn-help__topic" onclick={() => onSelectTopic(index)}>
            <span class="qn-help__topic-number">{index - topics.findIndex((candidate) => candidate.group === item.group) + 1}.</span>
            <span>{item.title}</span>
          </button>
        {/each}
      </nav>
      <article class="qn-help__body">
        <h3>{topics.findIndex((candidate) => candidate.group === topic.group) <= selectedTopic ? selectedTopic - topics.findIndex((candidate) => candidate.group === topic.group) + 1 : 1}. {topic.title}</h3>
        {#if topic.intro}<p>{topic.intro}</p>{/if}
        <ol>{#each topic.steps as step}<li>{step}</li>{/each}</ol>
        {#if topic.note}<p class="qn-help__note">{topic.note}</p>{/if}
      </article>
    </div>
  </div>
</div>
