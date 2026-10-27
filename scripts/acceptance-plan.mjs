#!/usr/bin/env node
// Plan completeness and evidence accounting only. This script does not call SiYuan or pi.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const levels = ['quick', 'standard', 'release'];
const statuses = new Set(['passed', 'failed', 'blocked', 'not_run']);

function initializer(source, name) {
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (declaration.name.getText(source) === name) return declaration.initializer;
        }
    }
    throw new Error(`Missing source declaration: ${name}`);
}
function unwrap(node) {
    while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    return node;
}

export function collectPlan(root = ROOT) {
    const config = ts.createSourceFile('config.ts', readFileSync(resolve(root, 'src/core/config.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const matrix = JSON.parse(readFileSync(resolve(root, 'tests/acceptance/scenarios.json'), 'utf8'));
    const categories = unwrap(initializer(config, 'TOOL_CATEGORIES')).elements.map(node => node.text);
    // Each tool declares its actions once, in order, in src/tools/<tool>/actions.ts.
    const actions = [];
    for (const tool of categories) {
        const source = ts.createSourceFile('actions.ts', readFileSync(resolve(root, `src/tools/${tool}/actions.ts`), 'utf8'), ts.ScriptTarget.Latest, true);
        const call = unwrap(initializer(source, `${tool.toUpperCase()}_ACTION_SPECS`));
        if (!ts.isCallExpression(call) || !ts.isObjectLiteralExpression(call.arguments[0])) throw new Error(`Unsupported action declaration syntax: ${tool}`);
        for (const property of call.arguments[0].properties) {
            const action = property.name.getText(source);
            const policyProperty = property.initializer.properties.find(p => p.name?.getText(source) === 'policy');
            const policy = policyProperty?.initializer;
            if (!policy || !ts.isCallExpression(policy) || !['read', 'mutation', 'external'].includes(policy.expression.getText(source))) throw new Error(`Missing safety policy: ${tool}.${action}`);
            const mode = policy.expression.getText(source);
            actions.push({
                key: `${tool}.${action}`, tool, action, mode,
                precondition: (policy.arguments[0] && ts.isStringLiteralLike(policy.arguments[0]) ? policy.arguments[0].text : undefined) ?? (mode === 'mutation' ? 'none' : null),
            });
        }
    }
    if (JSON.stringify([...new Set(actions.map(a => a.tool))]) !== JSON.stringify(categories)) throw new Error('Category order differs from source');
    const known = new Set(actions.map(a => a.key));
    const ids = new Set();
    for (const scenario of matrix.cases) {
        if (!scenario.id || ids.has(scenario.id)) throw new Error(`Duplicate or missing scenario ID: ${scenario.id}`);
        ids.add(scenario.id);
        if (!levels.includes(scenario.minimumTier) || !scenario.oracle || !scenario.gate || !scenario.persona || !scenario.actions?.length) throw new Error(`Incomplete scenario: ${scenario.id}`);
        if (!['planned', 'partial_existing'].includes(scenario.implementation)) throw new Error(`A plan cannot declare executed results: ${scenario.id}`);
        for (const key of scenario.actions) if (!known.has(key)) throw new Error(`Stale action in ${scenario.id}: ${key}`);
    }
    for (const action of actions) {
        action.scenarios = matrix.cases.filter(s => s.actions.includes(action.key)).map(s => s.id);
        if (!action.scenarios.length) throw new Error(`Unplanned source action: ${action.key}`);
    }
    return {
        schemaVersion: 1, plannedTools: categories.length, plannedActions: actions.length, plannedScenarios: matrix.cases.length,
        policyNote: 'Base policies only. Runtime argument branches (fs.write, file.create_template, document.ensure_link_targets) must also be tested; this inventory is not execution evidence.',
        actions, cases: matrix.cases,
    };
}

export function summarizeEvidence(plan, report) {
    if (report.schemaVersion !== 1 || !Array.isArray(report.actions)) throw new Error('Expected schemaVersion=1 and an actions array');
    const known = new Set(plan.actions.map(a => a.key));
    const positive = new Set(), denial = new Set(), failed = new Set();
    for (const item of report.actions) {
        if (!known.has(item.key)) throw new Error(`Unknown reported action: ${item.key}`);
        if (!statuses.has(item.status)) throw new Error(`Unknown status: ${item.status}`);
        if (item.status === 'passed') {
            if (!['success', 'expected_denial', 'help_only', 'mock'].includes(item.kind) || !item.evidenceFiles?.length) throw new Error(`Passed action lacks evidence: ${item.key}`);
            // Denial/help/mock evidence must never inflate positive functional coverage.
            if (item.kind === 'success' && item.real === true && item.readbackVerified === true) positive.add(item.key);
            if (item.kind === 'expected_denial' && item.real === true) denial.add(item.key);
        }
        if (item.status === 'failed') failed.add(item.key);
    }
    const covered = plan.actions.filter(a => positive.has(a.key));
    return {
        totalStaticActions: plan.plannedActions, totalStaticTools: plan.plannedTools,
        positiveActions: covered.length, positiveTools: new Set(covered.map(a => a.tool)).size,
        denialActions: denial.size, failedActions: failed.size,
        missingPositiveActions: plan.actions.filter(a => !positive.has(a.key)).map(a => a.key),
        note: 'Counts use report assertions; reviewers must inspect the referenced raw evidence. Metadata validation does not prove that calls occurred. Dynamic extension actions and MCP Apps launchers require separate accounting.',
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2); let output, reportPath;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--check') continue;
            if (args[i] === '--output' || args[i] === '--report') {
                const flag = args[i]; const value = args[++i];
                if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
                if (flag === '--output') output = resolve(value); else reportPath = resolve(value);
            } else throw new Error(`Unknown argument: ${args[i]}`);
        }
        const plan = collectPlan();
        const summary = reportPath ? summarizeEvidence(plan, JSON.parse(readFileSync(reportPath, 'utf8'))) : {
            plannedTools: plan.plannedTools, plannedActions: plan.plannedActions, plannedScenarios: plan.plannedScenarios,
            actualExecuted: 0, note: 'Plan validated; no live tests executed by this command.',
        };
        if (output) writeFileSync(output, JSON.stringify(plan, null, 2) + '\n');
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } catch (error) { process.stderr.write(`[acceptance-plan] ${error.message}\n`); process.exitCode = 1; }
}
