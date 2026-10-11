'use strict';

/**
 * Admin modal action-flow contract tests (master prompt Parts 7–19, 38;
 * test items 27–44).
 *
 * WHY source-contract: the web app has NO component test framework (no jsdom,
 * no React Testing Library — see the header of test-auth-flow.cjs), so these
 * tests assert the state-machine contract directly against the REAL page
 * sources. Each check guards the exact reported regression:
 * "API succeeds → modal stays permanently open with no clear result".
 *
 * Contract enforced for /admin/users (submitAction) and /admin/admins
 * (submitStaffAction / submitCreate / submitEditRoles):
 *   1. success closes ONLY the action dialog — except the one-time
 *      temporary-password acknowledgement (Close-only footer until read),
 *   2. success refreshes list/detail and shows a success toast AFTER close,
 *   3. the catch block NEVER closes the dialog and renders the error,
 *   4. finally re-enables the submit button (busy = false) for retry,
 *   5. a busy guard sits at the top of the handler (double-submit),
 *   6. open handlers clear stale error/notice/done/reason state,
 *   7. no setTimeout() anywhere in the action flow,
 *   8. the dialog `open` prop is bound to the action state,
 *   9. the real API call(s) resolve BEFORE the dialog closes (a close can never
 *      fake a success the server did not confirm).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const usersSrc = fs.readFileSync(path.join(webRoot, 'app/admin/users/page.tsx'), 'utf8');
const adminsSrc = fs.readFileSync(path.join(webRoot, 'app/admin/admins/page.tsx'), 'utf8');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures += 1;
    console.error('  \u2716 ' + name);
    console.error('    ' + (err && err.message ? err.message.split('\n').join('\n    ') : String(err)));
  }
}

/** Extracts `function <name>(...) {...}` (async or not) via brace matching. */
function extractFunction(src, name) {
  let start = src.indexOf(`async function ${name}(`);
  if (start < 0) start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Extracts the FIRST `} catch (...) { ... }` block inside fnSrc. */
function extractCatch(fnSrc) {
  const at = fnSrc.indexOf('} catch (');
  assert(at >= 0, 'no catch block found');
  const open = fnSrc.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < fnSrc.length; i++) {
    if (fnSrc[i] === '{') depth += 1;
    else if (fnSrc[i] === '}') {
      depth -= 1;
      if (depth === 0) return fnSrc.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced catch block');
}

/** Shared success/failure contract for one submit handler. */
function assertActionContract(label, fnSrc, opts) {
  // 5. busy guard + busy set
  assert(fnSrc.includes(`if (${opts.busyFlag}`), `${label}: missing ${opts.busyFlag} double-submit guard`);
  assert(fnSrc.includes(`${opts.setBusy}(true)`), `${label}: never enters the busy state`);

  // 7. no setTimeout hiding the bug
  assert(!fnSrc.includes('setTimeout'), `${label}: must not use setTimeout to fake success`);

  // 1. success closes the action dialog, BEFORE the toast surfaces
  const closeIdx = fnSrc.indexOf(opts.closeCall);
  assert(closeIdx > 0, `${label}: success path never closes the dialog (${opts.closeCall})`);
  const toastIdx = fnSrc.indexOf('toast(');
  assert(toastIdx > 0, `${label}: success path shows no toast result`);
  assert(closeIdx < toastIdx, `${label}: dialog must close before the success toast`);

  // 2. success refreshes the underlying list
  assert(fnSrc.includes(opts.refreshCall), `${label}: success path never refreshes (${opts.refreshCall})`);

  // 1b. one-time temp-password acknowledgement (stays open on purpose)
  if (opts.oneTime) {
    assert(fnSrc.includes('oneTimeNotice'), `${label}: missing one-time temp-password notice`);
    assert(
      fnSrc.includes(`${opts.setDone}(true)`),
      `${label}: missing the acknowledged-success state (${opts.setDone})`,
    );
    assert(
      fnSrc.includes(`${opts.setDone}(false)`),
      `${label}: acknowledged-success state is never cleared`,
    );
  }

  // 3. failure keeps the dialog open and shows the error
  const catchSrc = extractCatch(fnSrc);
  assert(catchSrc.includes(opts.errorCall), `${label}: failure path does not render the error`);
  assert(
    !catchSrc.includes(opts.closeCall),
    `${label}: failure path closes the dialog (must stay open for retry)`,
  );

  // 9. every declared API call must be present AND resolve before the dialog
  //    closes — guards against a close() that fires without the request
  //    (i.e. a "success" the server never confirmed).
  const apiCalls = opts.apiCalls ?? [];
  assert(apiCalls.length > 0, `${label}: no API call declared for this handler`);
  for (const call of apiCalls) {
    const apiIdx = fnSrc.indexOf(call);
    assert(apiIdx > 0, `${label}: missing API call ${call}`);
    assert(apiIdx < closeIdx, `${label}: ${call} must resolve BEFORE ${opts.closeCall}`);
  }

  // 4. finally re-enables the button
  const finallyIdx = fnSrc.indexOf('finally');
  assert(finallyIdx > 0, `${label}: missing finally cleanup`);
  assert(
    fnSrc.indexOf(`${opts.setBusy}(false)`, finallyIdx) > finallyIdx,
    `${label}: finally does not reset ${opts.setBusy} (button stays disabled)`,
  );
}

// ---------------------------------------------------------------------------
// /admin/users — ModerationDialog state machine (items 27–38)
// ---------------------------------------------------------------------------
const submitAction = extractFunction(usersSrc, 'submitAction');

test('users: submitAction success/failure state machine (items 27–38)', () => {
  assertActionContract('users.submitAction', submitAction, {
    closeCall: 'setAction(null)',
    errorCall: 'setActionError(',
    setBusy: 'setActionBusy',
    busyFlag: 'actionBusy',
    refreshCall: 'await load()',
    oneTime: true,
    setDone: 'setActionDone',
    apiCalls: [
      'await updateAdminUserProfile(',
      'await resetAdminUserPassword(',
      'await suspendAdminUser(',
      'await unsuspendAdminUser(',
      'await banAdminUser(',
      'await unbanAdminUser(',
      'await softDeleteAdminUser(',
    ],
  });
});

test('users: edit/suspend/unsuspend/ban/unban/reset all report success results', () => {
  for (const msg of [
    'Profile updated successfully.',
    'Account suspended — all active sessions were revoked.',
    'Account reactivated. The user signs in again.',
    'Account banned — all active sessions were revoked.',
    'Ban lifted. The user signs in again.',
    'Password reset successfully.',
  ]) {
    assert(submitAction.includes(msg), `missing success result: ${msg}`);
  }
});

test('users: success state (notice/reason/newPassword) is fully cleared on close', () => {
  assert(submitAction.includes('setActionNotice(null)'), 'stale success notice survives');
  assert(submitAction.includes("setReason('')"), 'stale reason survives');
  assert(submitAction.includes("setNewPassword('')"), 'stale password input survives');
});

test('users: openAction clears stale error/notice/done/reason (no cross-user leaks)', () => {
  const open = extractFunction(usersSrc, 'openAction');
  for (const clear of [
    'setActionError(null)',
    'setActionNotice(null)',
    'setActionDone(false)',
    "setReason('')",
  ]) {
    assert(open.includes(clear), `openAction does not reset ${clear}`);
  }
});

test('users: closeAction clears the dialog state as well', () => {
  const close = extractFunction(usersSrc, 'closeAction');
  assert(close.includes('setAction(null)'), 'closeAction does not close');
  assert(close.includes('setActionError(null)'), 'closeAction keeps the error');
  assert(close.includes('setActionNotice(null)'), 'closeAction keeps the notice');
});

test('users: dialog open prop bound to action state; submit button shows loading', () => {
  assert(
    usersSrc.includes('open={action !== null && detail !== null}'),
    'ModerationDialog is not bound to the action state',
  );
  assert(usersSrc.includes('loading={actionBusy}'), 'submit button has no loading/disabled state');
});

test('users: one-time temp-password result swaps the footer for Close-only', () => {
  assert(usersSrc.includes('actionDone ? ('), 'footer is not conditional on actionDone');
  assert(
    usersSrc.includes('<Button onClick={closeAction}>Close</Button>'),
    'acknowledgement footer missing Close-only button',
  );
});

// ---------------------------------------------------------------------------
// /admin/admins — staff action state machine (items 39–44)
// ---------------------------------------------------------------------------
const submitStaffAction = extractFunction(adminsSrc, 'submitStaffAction');

test('admins: submitStaffAction success/failure state machine (items 39–44)', () => {
  assertActionContract('admins.submitStaffAction', submitStaffAction, {
    closeCall: 'setStaffAction(null)',
    errorCall: 'setStaffError(',
    setBusy: 'setStaffBusy',
    busyFlag: 'staffBusy',
    refreshCall: 'await loadUsers()',
    oneTime: true,
    setDone: 'setStaffDone',
    apiCalls: [
      'await updateStaffProfile(',
      'await resetStaffPassword(',
      'await deactivateStaff(',
    ],
  });
});

test('admins: staff edit / reset / deactivate all report success results', () => {
  for (const msg of [
    'Admin account updated successfully.',
    'Password reset successfully.',
    'deactivated — ',
  ]) {
    assert(submitStaffAction.includes(msg), `missing success result: ${msg}`);
  }
  // Deactivate also refreshes + closes like the others (regression: it used to
  // be the ONLY action that closed).
  assert(submitStaffAction.includes('rolesRemoved.length'), 'deactivate result details missing');
});

test('admins: reset-password now refreshes the staff list too', () => {
  const resetIdx = submitStaffAction.indexOf('resetStaffPassword(');
  assert(resetIdx > 0, 'reset-password handler missing');
  // Scope the refresh check to the reset branch itself — the edit-profile
  // branch above it refreshes too, so the first match is not the reset one.
  const resetBranch = submitStaffAction.slice(resetIdx);
  assert(
    resetBranch.includes('await loadUsers()'),
    'staff list not refreshed after password reset',
  );
});

test('admins: openStaffAction clears stale error/notice/done/reason/password', () => {
  const open = extractFunction(adminsSrc, 'openStaffAction');
  for (const clear of [
    'setStaffError(null)',
    'setStaffNotice(null)',
    'setStaffDone(false)',
    "setStaffReason('')",
    "setStaffNewPassword('')",
  ]) {
    assert(open.includes(clear), `openStaffAction does not reset ${clear}`);
  }
});

test('admins: closeStaffAction clears the dialog state as well', () => {
  const close = extractFunction(adminsSrc, 'closeStaffAction');
  assert(close.includes('setStaffAction(null)'), 'closeStaffAction does not close');
  assert(close.includes('setStaffError(null)'), 'closeStaffAction keeps the error');
  assert(close.includes('setStaffNotice(null)'), 'closeStaffAction keeps the notice');
});

test('admins: create-admin success closes → refreshes → toasts (items 39/43/44)', () => {
  const create = extractFunction(adminsSrc, 'submitCreate');
  assertActionContract('admins.submitCreate', create, {
    closeCall: 'setCreateOpen(false)',
    errorCall: 'setFormError(',
    setBusy: 'setCreating',
    busyFlag: 'creating',
    refreshCall: 'await loadUsers()',
    oneTime: false,
    setDone: 'setStaffDone',
    apiCalls: ['await createAdminUser('],
  });
});

test('admins: role-edit success closes → refreshes → toasts (items 39/43/44)', () => {
  const roles = extractFunction(adminsSrc, 'submitEditRoles');
  assertActionContract('admins.submitEditRoles', roles, {
    closeCall: 'setEditTarget(null)',
    errorCall: 'setEditError(',
    setBusy: 'setSavingRoles',
    busyFlag: 'savingRoles',
    refreshCall: 'await loadUsers()',
    oneTime: false,
    setDone: 'setStaffDone',
    apiCalls: ['await updateAdminUserRoles('],
  });
});

test('admins: staff dialog open prop bound to action state; buttons show loading', () => {
  assert(
    adminsSrc.includes('open={staffAction !== null}'),
    'staff dialog is not bound to the action state',
  );
  assert(adminsSrc.includes('loading={staffBusy}'), 'staff submit button has no loading state');
});

test('admins: one-time temp-password result swaps the footer for Close-only', () => {
  assert(adminsSrc.includes('staffDone ? ('), 'footer is not conditional on staffDone');
  assert(
    adminsSrc.includes('<Button onClick={closeStaffAction}>Close</Button>'),
    'acknowledgement footer missing Close-only button',
  );
});

test('admins: ADMINS_READ permits the directory while mutations stay Master-only', () => {
  assert(adminsSrc.includes('if (!canReadAdmins) {'), 'directory read gate is not based on ADMINS_READ');
  assert(
    adminsSrc.includes('const canCreateAdmin = isSuperAdmin && hasCreateAdminPermission'),
    'create-admin control is not Master-only',
  );
  assert(
    adminsSrc.includes('const canManageDirectPermissions = isSuperAdmin && hasManageDirectPermissionsPermission'),
    'direct permission editor is not Master-only',
  );
  assert(
    adminsSrc.includes('if (savingRoles || !editTarget || !canManageRoles) return'),
    'role mutation handler lacks a capability guard',
  );
  assert(
    adminsSrc.includes('disabled={!isSuperAdmin}'),
    'roles tab should remain unavailable to ordinary staff',
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} admin modal-flow test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll admin modal-flow tests passed.');

