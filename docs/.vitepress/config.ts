import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'SiYuan Sisyphus MCP & CLI',
  description: 'Documentation for SiYuan Sisyphus MCP & CLI Plugin',
  base: '/siyuan-plugins-mcp-sisyphus/',

  // 多语言配置
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/' },
          { text: 'Getting Started', link: '/getting-started/' },
          { text: 'Reference', link: '/reference/' },
          { text: 'Architecture', link: '/architecture/' },
          { text: 'Development', link: '/development/' },
        ],
        sidebar: {
          '/': [
            {
              text: 'Getting Started',
              items: [
                { text: 'Overview', link: '/' },
                { text: 'Quick Start', link: '/getting-started/' },
                { text: 'Deployment', link: '/getting-started/deployment' },
                { text: 'HTTPS', link: '/getting-started/https' },
                { text: 'Troubleshooting', link: '/getting-started/troubleshooting' },
              ],
            },
            {
              text: 'Reference',
              items: [
                { text: 'Reference Home', link: '/reference/' },
                { text: 'Common Tasks', link: '/reference/common-tasks' },
                { text: 'Permissions', link: '/reference/permissions' },
                { text: 'Path Semantics', link: '/reference/path-semantics' },
                { text: 'Error Types', link: '/reference/error-types' },
                { text: 'Tools Index', link: '/reference/tools/' },
                { text: 'Insights', link: '/insights' },
              ],
            },
            {
              text: 'Architecture',
              items: [
                { text: 'Architecture Home', link: '/architecture/' },
                { text: 'Overview', link: '/architecture/overview' },
                { text: 'Modules', link: '/architecture/modules' },
                { text: 'Data Flow', link: '/architecture/data-flow' },
                { text: 'Design Decisions', link: '/architecture/design-decisions' },
                { text: 'Extension Points', link: '/architecture/extension-points' },
              ],
            },
            {
              text: 'Development',
              items: [
                { text: 'Development Home', link: '/development/' },
                { text: 'Setup', link: '/development/setup' },
                { text: 'Build and Workflow', link: '/development/build-and-workflow' },
                { text: 'Testing', link: '/development/testing' },
                { text: 'Live Notebook Testing', link: '/development/live-notebook-testing' },
                { text: 'Conventions', link: '/development/conventions' },
                { text: 'Adding Tools', link: '/development/adding-tools' },
                { text: 'Adding Actions', link: '/development/adding-actions' },
                { text: 'Debugging', link: '/development/debugging' },
                { text: 'Release CLI', link: '/development/release-cli' },
              ],
            },
          ],
        },
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '快速开始', link: '/zh/getting-started/' },
          { text: '参考', link: '/zh/reference/' },
          { text: '架构', link: '/zh/architecture/' },
          { text: '开发', link: '/zh/development/' },
        ],
        sidebar: {
          '/zh/': [
            {
              text: '快速开始',
              items: [
                { text: '概述', link: '/zh/' },
                { text: '开始使用', link: '/zh/getting-started/' },
                { text: '部署指南', link: '/zh/getting-started/deployment' },
                { text: 'HTTPS 配置', link: '/zh/getting-started/https' },
                { text: '故障排查', link: '/zh/getting-started/troubleshooting' },
              ],
            },
            {
              text: '参考',
              items: [
                { text: '参考首页', link: '/zh/reference/' },
                { text: '常见任务', link: '/zh/reference/common-tasks' },
                { text: '权限模型', link: '/zh/reference/permissions' },
                { text: '路径语义', link: '/zh/reference/path-semantics' },
                { text: '错误类型', link: '/zh/reference/error-types' },
                { text: '工具索引', link: '/zh/reference/tools/' },
                { text: '经验洞察', link: '/zh/insights' },
              ],
            },
            {
              text: '架构',
              items: [
                { text: '架构首页', link: '/zh/architecture/' },
                { text: '总览', link: '/zh/architecture/overview' },
                { text: '模块划分', link: '/zh/architecture/modules' },
                { text: '数据流', link: '/zh/architecture/data-flow' },
                { text: '设计决策', link: '/zh/architecture/design-decisions' },
                { text: '扩展点', link: '/zh/architecture/extension-points' },
              ],
            },
            {
              text: '开发',
              items: [
                { text: '开发首页', link: '/zh/development/' },
                { text: '环境搭建', link: '/zh/development/setup' },
                { text: '构建与工作流', link: '/zh/development/build-and-workflow' },
                { text: '测试', link: '/zh/development/testing' },
                { text: '真实笔记本测试', link: '/zh/development/live-notebook-testing' },
                { text: '规范约定', link: '/zh/development/conventions' },
                { text: '添加工具', link: '/zh/development/adding-tools' },
                { text: '添加动作', link: '/zh/development/adding-actions' },
                { text: '调试', link: '/zh/development/debugging' },
                { text: '发布 CLI', link: '/zh/development/release-cli' },
              ],
            },
          ],
        },
      },
    },
  },

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/yangtaihong59/siyuan-plugins-mcp-sisyphus',
      },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present Taihong Yang',
    },

    search: {
      provider: 'local',
    },
  },
})
