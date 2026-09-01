<script lang="ts">
  export let name: "folder" | "fit" | "zoomBox" | "section" | "moon" | "sun" | "globe" | "panel" | "settings" | "help" | "close" | "pan" | "multiSelect" | "measure" | "point" | "edge" | "trash";
  export let size = 20;
</script>

<svg
  aria-hidden="true"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === "folder"}
    <path d="M3 7.5h6l2 2h10v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M3 10V6a2 2 0 0 1 2-2h4l2 2h5" />
  {:else if name === "fit"}
    <path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M21 16v4a1 1 0 0 1-1 1h-4M8 21H4a1 1 0 0 1-1-1v-4" />
  {:else if name === "zoomBox"}
    <circle cx="10" cy="10" r="6.5" />
    <path d="m15 15 6 6M7 7h6v6H7z" />
  {:else if name === "section"}
    <path d="M4 6.5 12 3l8 3.5-8 3.5zM4 12l8 3.5 8-3.5M4 17.5 12 21l8-3.5" />
    <path d="M12 10v5.5" />
  {:else if name === "moon"}
    <path d="M20.5 14.2A8.4 8.4 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2z" />
  {:else if name === "sun"}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
  {:else if name === "globe"}
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  {:else if name === "panel"}
    <rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M14 4v16" />
  {:else if name === "settings"}
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.33.7.6 1 .27.27.62.48 1 .6h.1v4H21a1.7 1.7 0 0 0-1.6 1.1z" />
  {:else if name === "help"}
    <circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.3 1-1.3 1.9M12 17h.01" />
  {:else if name === "pan"}
    <path d="M8.5 11V6.5a1.5 1.5 0 0 1 3 0V10M11.5 9V5.5a1.5 1.5 0 0 1 3 0V10M14.5 9V7a1.5 1.5 0 0 1 3 0v5M8.5 9.5V9a1.5 1.5 0 0 0-3 0v4.2c0 4.3 2.7 7.3 6.8 7.3h.9c4.2 0 6.8-2.8 6.8-7V10a1.5 1.5 0 0 0-2.5-1.1" />
  {:else if name === "multiSelect"}
    <rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /><path d="M14 4h6v6M4 14v6h6" stroke-dasharray="2 2" />
  {:else if name === "measure"}
    <path d="m5 18 13-13 2 2L7 20z" /><path d="m9 14 2 2m1-5 2 2m1-5 2 2" />
  {:else if name === "point"}
    <circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M7 17 17 7" stroke-dasharray="2.5 2.5" />
  {:else if name === "edge"}
    <path d="M4 18 19 6" /><circle cx="4" cy="18" r="2" /><circle cx="19" cy="6" r="2" />
  {:else if name === "trash"}
    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
  {:else}
    <path d="M6 6l12 12M18 6 6 18" />
  {/if}
</svg>
