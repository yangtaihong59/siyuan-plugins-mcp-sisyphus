import type { ToolCategory } from "./tool-config";

export interface TabItem {
    id: string;
    label: string;
    description: string;
    iconSvg: string;
}

export interface CategoryTabDefinition {
    category: ToolCategory;
    groupKey: string;
    iconKey: string;
}

export const ICON_SVGS: Record<string, string> = {
    globe: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>`,
    fileText: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
    layout: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>`,
    database: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C7.58 2 4 3.79 4 6v12c0 2.21 3.59 4 8 4s8-1.79 8-4V6c0-2.21-3.58-4-8-4zm0 2c3.31 0 6 1.34 6 3s-2.69 3-6 3-6-1.34-6-3 2.69-3 6-3zm0 14c-3.31 0-6-1.34-6-3v-2.17c1.28.74 2.83 1.17 4.5 1.17h3c1.67 0 3.22-.43 4.5-1.17V15c0 1.66-2.69 3-6 3zm0 2c-3.31 0-6-1.34-6-3v-2.17c1.28.74 2.83 1.17 4.5 1.17h3c1.67 0 3.22-.43 4.5-1.17V17c0 1.66-2.69 3-6 3z"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
    paperclip: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
    brain: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M9.5 3A3.5 3.5 0 0 0 6 6.5v.18A3.5 3.5 0 0 0 4.5 13v.5A3.5 3.5 0 0 0 8 17h.5v1.5a2.5 2.5 0 0 0 5 0V5.5A2.5 2.5 0 0 0 11 3H9.5zm5 2.5v13a2.5 2.5 0 0 0 5 0V17h.5a3.5 3.5 0 0 0 3.5-3.5V13A3.5 3.5 0 0 0 22 6.68V6.5A3.5 3.5 0 0 0 18.5 3H17a2.5 2.5 0 0 0-2.5 2.5z" transform="translate(-2) scale(.92)"/></svg>`,
    tagIcon: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>`,
    monitor: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v2h12v-2l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/></svg>`,
    layers: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>`,
    paw: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="6.5" cy="7.2" r="2.2"/><circle cx="11.3" cy="5.2" r="2.25"/><circle cx="16.3" cy="6.8" r="2.2"/><circle cx="19" cy="11.2" r="2"/><path d="M12.2 10.2c-3.7 0-7 3.1-7 6.4 0 2.2 1.7 3.7 3.8 3.7 1.2 0 2.1-.6 3.2-.6 1 0 2 .6 3.2.6 2.1 0 3.7-1.5 3.7-3.7 0-3.3-3.2-6.4-6.9-6.4z"/></svg>`,
    barChart: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>`,
    compass: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 14L12 13l-4.5 3 1.5-5.5L5 9l5.5-.5L12 3l1.5 5.5L19 9l-4 1.5 1.5 5.5z"/></svg>`,
    bug: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20 8h-2.81c-.45-.78-1.08-1.45-1.83-1.95L17 4.41 15.59 3 13.5 5.09C13.02 5.03 12.52 5 12 5s-1.02.03-1.5.09L8.41 3 7 4.41l1.64 1.64C7.89 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81C7.85 19.79 9.79 21 12 21s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 9h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>`,
    message: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M4 4h16c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H8l-5 4v-4H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm2 4v2h12V8H6zm0 4v2h8v-2H6z"/></svg>`,
};

export const CATEGORY_TAB_DEFS: CategoryTabDefinition[] = [
    { category: "fs", groupKey: "Filesystem", iconKey: "folder" },
    { category: "notebook", groupKey: "Notebooks", iconKey: "book" },
    { category: "document", groupKey: "Documents", iconKey: "fileText" },
    { category: "block", groupKey: "Blocks", iconKey: "layout" },
    { category: "av", groupKey: "Databases", iconKey: "database" },
    { category: "file", groupKey: "Files", iconKey: "paperclip" },
    { category: "search", groupKey: "Search", iconKey: "search" },
    { category: "tag", groupKey: "Tags", iconKey: "tagIcon" },
    { category: "timeline", groupKey: "Timeline", iconKey: "compass" },
    { category: "system", groupKey: "System", iconKey: "monitor" },
    { category: "flashcard", groupKey: "Flashcards", iconKey: "layers" },
    { category: "extension", groupKey: "Extension Tools", iconKey: "layers" },
    { category: "mascot", groupKey: "Mascot Tool", iconKey: "paw" },
    { category: "feedback", groupKey: "Feedback Tool", iconKey: "message" },
];

export const HTTP_GROUP_KEY = "Connection Config";
export const PERM_GROUP_KEY = "Permissions";
export const TOOL_GROUP_KEY = "Tool Settings";
export const MCP_APPS_GROUP_KEY = "MCP Apps";
export const EMBEDDING_GROUP_KEY = "Embedding Model";
export const PUPPY_GROUP_KEY = "Mascot Display";
export const ANALYTICS_GROUP_KEY = "analyticsGroupTitle";
export const DEBUG_GROUP_KEY = "debugGroupTitle";
export const USER_RULES_GROUP_KEY = "User Rules";
export const FEEDBACK_GROUP_KEY = "feedbackGroupTitle";
