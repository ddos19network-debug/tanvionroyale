'use strict';

/**
 * Global success/failure UX contract tests (master prompt Parts 3–14, 34–37,
 * 41–42 A–I, acceptance items 27–28).
 *
 * WHY source-contract: the web app has NO component-test framework (no jsdom /
 * React Testing Library — see the header of test-auth-flow.cjs), so these tests
 * assert the state machine directly against the REAL page sources.
 *
 * The single reported regression this suite guards:
 *   "the API call succeeds, the toast/banner is shown, and the user is left
 *    sitting inside a form that has already been submitted" — plus its twin
 *    "the API call fails and the dialog closes / the error disappears".
 *
 * Contract enforced for every audited mutation handler:
 *   1. a double-submit guard sits at the top (`if (busy) return`) and the busy
 *      flag is raised before the request (Part 35),
 *   2. the real API call is awaited BEFORE any success transition — a UI
 *      transition can never fake a success the server did not confirm
 *      (Part 3 "WAIT FOR ACTUAL RESPONSE"),
 *   3. success closes the modal / swaps the completed form for a dedicated
 *      success state, THEN refreshes the affected data, THEN reports success
 *      (Parts 3, 34, 37),
 *   4. the catch block NEVER closes the dialog, never navigates, and always
 *      renders the error (Part 5),
 *   5. `finally` restores the busy flag so the user can retry (Part 35),
 *   6. sensitive/one-shot fields are cleared ONLY inside the success path
 *      (Part 36 — a failure preserves every entered value),
 *   7. no `setTimeout()` is used to fake a close or hide an error (Part 42 H).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');

function read(rel) {
  const file = path.join(webRoot, ...rel.split('/'));
  assert(fs.existsSync(file), `missing source file ${rel}`);
  return fs.readFileSync(file, 'utf8');
}

const src = {
  deposit: read('app/(user)/wallet/deposit/page.tsx'),
  withdraw: read('app/(user)/wallet/withdraw/page.tsx'),
  profile: read('app/(user)/profile/page.tsx'),
  settings: read('app/(user)/settings/page.tsx'),
  chat: read('app/(user)/support/chat/page.tsx'),
  report: read('app/(user)/support/report/page.tsx'),
  paymentMethods: read('app/admin/payment-methods/page.tsx'),
  paymentGateways: read('app/admin/payment-gateways/page.tsx'),
  manualDeposits: read('app/admin/manual-deposits/page.tsx'),
  manualWithdrawals: read('app/admin/manual-withdrawals/page.tsx'),
  adminSupport: read('app/admin/support/page.tsx'),
};

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures += 1;
    console.error('  \u2716 ' + name);
    console.error(
      '    ' +
        (err && err.message ? err.message.split('\n').join('\n    ') : String(err)),
    );
  }
}

/** Extracts `[async] function <name>(...) {...}` via brace matching. */
function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Extracts the body of the FIRST `try { ... }` block. */
function extractTry(fnSrc) {
  const at = fnSrc.indexOf('try {');
  assert(at >= 0, 'no try block found');
  const open = fnSrc.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < fnSrc.length; i++) {
    if (fnSrc[i] === '{') depth += 1;
    else if (fnSrc[i] === '}') {
      depth -= 1;
      if (depth === 0) return fnSrc.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced try block');
}

/** Extracts the FIRST `} catch (...) { ... }` (or `} catch { ... }`) block. */
function extractCatch(fnSrc) {
  let atIdx = fnSrc.indexOf('} catch (');
  if (atIdx < 0) atIdx = fnSrc.indexOf('} catch {');
  assert(atIdx >= 0, 'no catch block found');
  const open = fnSrc.indexOf('{', atIdx);
  let depth = 0;
  for (let i = open; i < fnSrc.length; i++) {
    if (fnSrc[i] === '{') depth += 1;
    else if (fnSrc[i] === '}') {
      depth -= 1;
      if (depth === 0) return fnSrc.slice(atIdx, i + 1);
    }
  }
  throw new Error('unbalanced catch block');
}

/** indexOf with a helpful failure message. */
function at(haystack, needle, label) {
  const i = haystack.indexOf(needle);
  assert(i >= 0, `${label}: expected to find \`${needle}\``);
  return i;
}

/** Asserts the needles appear in the given order inside `body`. */
function order(label, body, ...needles) {
  let prev = -1;
  let prevNeedle = 'start';
  for (const n of needles) {
    const i = at(body, n, label);
    assert(i > prev, `${label}: \`${n}\` must come AFTER \`${prevNeedle}\``);
    prev = i;
    prevNeedle = n;
  }
}

/** Removes whole-line `//`, `/*` and `*` comments (used for hack detection). */
function stripCommentLines(code) {
  return code
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** Shared contract: guard → busy → await API → success → error path → finally. */
function assertMutationContract(label, fnSrc, opts) {
  assert(
    fnSrc.includes(`if (${opts.busyFlag}`),
    `${label}: missing \`if (${opts.busyFlag})\` double-submit guard (Part 35)`,
  );
  const enterBusy = opts.enterBusy || `${opts.setBusy}(true)`;
  const exitBusy = opts.exitBusy || `${opts.setBusy}(false)`;
  assert(fnSrc.includes(enterBusy), `${label}: never enters the busy state (\`${enterBusy}\`)`);
  assert(fnSrc.includes(exitBusy), `${label}: never restores the busy state (\`${exitBusy}\`)`);

  const tryBody = extractTry(fnSrc);
  for (const call of opts.apiCalls) {
    const idx = at(tryBody, call, `${label} try-block`);
    const pre = tryBody.slice(Math.max(0, idx - 30), idx);
    assert(
      pre.includes('await'),
      `${label}: \`${call}\` must be awaited BEFORE any success transition (Part 3)`,
    );
  }

  // No fake-close / error-hiding timer in executable code.
  assert(
    !stripCommentLines(fnSrc).includes('setTimeout'),
    `${label}: setTimeout() must not be used here (Part 42 H)`,
  );

  const catchBody = extractCatch(fnSrc);
  for (const close of opts.closeCalls || []) {
    assert(
      !catchBody.includes(close),
      `${label}: failure must NOT close the dialog (\`${close}\` found in catch) — Part 5`,
    );
  }
  assert(
    !catchBody.includes('router.push') && !catchBody.includes('router.replace'),
    `${label}: failure must NOT navigate away (Part 5)`,
  );
  assert(
    opts.errorCall.some((c) => catchBody.includes(c)),
    `${label}: failure is silent — no error surfaced (Part 5)`,
  );

  // finally must restore the busy flag.
  const finallyAt = fnSrc.indexOf('} finally {');
  assert(finallyAt > 0, `${label}: no finally block`);
  assert(
    fnSrc.slice(finallyAt).includes(exitBusy),
    `${label}: finally does not restore \`${exitBusy}\``,
  );
}

// ---------------------------------------------------------------------------
// PART 6 — DEPOSIT (/wallet/deposit)
// ---------------------------------------------------------------------------
const depositSubmit = extractFunction(src.deposit, 'handleSubmit');

test('deposit: success flow has guard → busy → awaited API → success state (Parts 6/35)', () => {
  assertMutationContract('deposit.handleSubmit', depositSubmit, {
    busyFlag: 'submitting',
    setBusy: 'setSubmitting',
    apiCalls: ['submitManualDeposit('],
    closeCalls: [],
    errorCall: ['setFormError('],
  });
});

test('deposit: the request resolves BEFORE the UI moves on (Part 3)', () => {
  order(
    'deposit success ordering',
    depositSubmit,
    'await submitManualDeposit(',
    'setSubmitted(result.deposit)',
    'await loadHistory()',
  );
});

test('deposit: success clears every sensitive field and resets the file input (Part 6)', () => {
  const tryBody = extractTry(depositSubmit);
  for (const clear of [
    "setAmount('')",
    "setReferenceId('')",
    "setProofDataUrl('')",
    "setProofFileName('')",
  ]) {
    assert(tryBody.includes(clear), `deposit success does not clear ${clear}`);
  }
  assert(
    tryBody.includes("'deposit-proof'"),
    'deposit success does not reset the native file input value',
  );
  assert(tryBody.includes("fileInput.value = ''"), 'deposit file input value is not cleared');
});

test('deposit: a FAILURE keeps every entered value (Part 36)', () => {
  const catchBody = extractCatch(depositSubmit);
  for (const clear of ["setAmount('')", "setReferenceId('')", "setProofDataUrl('')"]) {
    assert(!catchBody.includes(clear), `deposit failure must NOT clear ${clear}`);
  }
  assert(
    !catchBody.includes('setSubmitted('),
    'deposit failure must not show the success state',
  );
});

test('deposit: the completed form is replaced by a dedicated success state (Part 6)', () => {
  assert(src.deposit.includes('{submitted ? ('), 'no dedicated deposit success state rendered');
  assert(
    src.deposit.includes('onClick={resetAfterSuccess}'),
    'the success state offers no "make another deposit" action',
  );
  assert(
    src.deposit.includes('submitted.referenceId') && src.deposit.includes('submitted.status'),
    'the success state does not show the confirmed reference/status',
  );
});

test('deposit: the submit button is disabled while the request is in flight (Part 35)', () => {
  assert(src.deposit.includes('submitting ||'), 'submit button is not disabled while submitting');
  assert(src.deposit.includes("'Submitting...'"), 'submit button shows no loading label');
});

test('deposit: no redirect is used at all — success stays in the wallet (Parts 4/6)', () => {
  assert(!depositSubmit.includes('router.push'), 'deposit submit must not route');
  assert(!depositSubmit.includes('router.replace'), 'deposit submit must not route');
});

// ---------------------------------------------------------------------------
// PART 7 — WITHDRAW (/wallet/withdraw)
// ---------------------------------------------------------------------------
const withdrawSubmit = extractFunction(src.withdraw, 'onSubmit');

test('withdraw: success flow has guard → busy → awaited API → success state (Parts 7/35)', () => {
  assertMutationContract('withdraw.onSubmit', withdrawSubmit, {
    busyFlag: 'submitting',
    setBusy: 'setSubmitting',
    apiCalls: ['submitManualWithdrawal(', 'createWithdrawal('],
    closeCalls: [],
    errorCall: ['setError('],
  });
});

test('withdraw: the request resolves BEFORE the UI moves on (Part 3)', () => {
  const manualAt = at(withdrawSubmit, 'await submitManualWithdrawal(', 'withdraw manual branch');
  assert(
    withdrawSubmit.slice(manualAt).indexOf('setSubmitted(') > 0,
    'manual withdrawal shows the success state before the API confirms',
  );
  const gatewayAt = at(withdrawSubmit, 'await createWithdrawal(', 'withdraw gateway branch');
  assert(
    withdrawSubmit.slice(gatewayAt).indexOf('setSubmitted(') > 0,
    'gateway withdrawal shows the success state before the API confirms',
  );
});

test('withdraw: success refreshes the balance from the server response (Part 34)', () => {
  const tryBody = extractTry(withdrawSubmit);
  const matches = tryBody.match(/setAvailableBalance\(result\.wallet\.availableBalance\)/g) || [];
  assert(matches.length >= 2, 'both withdrawal flows must revalidate the balance from the response');
});

test('withdraw: success clears destination/amount fields, failure preserves them (Parts 7/36)', () => {
  const tryBody = extractTry(withdrawSubmit);
  const catchBody = extractCatch(withdrawSubmit);
  for (const clear of [
    "setAmount('')",
    "setAccountNumber('')",
    "setAccountName('')",
    "setBankName('')",
    "setBranch('')",
    "setRoutingNumber('')",
  ]) {
    assert(tryBody.includes(clear), `withdraw success does not clear ${clear}`);
    assert(!catchBody.includes(clear), `withdraw failure must NOT clear ${clear} (Part 36)`);
  }
});

test('withdraw: the completed form is replaced by a dedicated success state (Part 7)', () => {
  assert(src.withdraw.includes('{submitted ? ('), 'no dedicated withdrawal success state rendered');
  for (const field of ['{submitted.message}', '{submitted.reference}']) {
    assert(src.withdraw.includes(field), `the withdrawal success state does not show ${field}`);
  }
  assert(
    src.withdraw.includes('{submitted.status}') || src.withdraw.includes('submitted.status'),
    'the withdrawal success state does not show the confirmed status',
  );
  assert(
    src.withdraw.includes('onClick={resetAfterSuccess}'),
    'the success state offers no "make another withdrawal" action',
  );
});

test('withdraw: submit button disabled + loading while in flight (Part 35)', () => {
  assert(src.withdraw.includes('type="submit"'), 'withdraw submit is not a submit button');
  assert(src.withdraw.includes('submitting ||'), 'withdraw submit is not disabled while submitting');
  assert(
    src.withdraw.includes('Submitting withdrawal'),
    'withdraw submit button shows no loading label',
  );
});

test('withdraw: no redirect — the user is never bounced out of the wallet (Parts 4/7)', () => {
  assert(!withdrawSubmit.includes('router.push'), 'withdraw submit must not route');
  assert(!withdrawSubmit.includes('router.replace'), 'withdraw submit must not route');
});

// ---------------------------------------------------------------------------
// PART 8/9 — ADMIN USERS + ADMIN STAFF (modal action categories)
// ---------------------------------------------------------------------------
const usersSrc = read('app/admin/users/page.tsx');
const adminsSrc = read('app/admin/admins/page.tsx');
const userAction = extractFunction(usersSrc, 'submitAction');
const staffAction = extractFunction(adminsSrc, 'submitStaffAction');

test('admin users: action dialog closes on CONFIRMED success, then list refreshes (Parts 8/37)', () => {
  assertMutationContract('admin users submitAction', userAction, {
    busyFlag: 'actionBusy',
    setBusy: 'setActionBusy',
    apiCalls: ['updateAdminUserProfile(', 'resetAdminUserPassword(', 'suspendAdminUser('],
    closeCalls: ['setAction(null)'],
    errorCall: ['setActionError('],
  });
  order('admin users success ordering', userAction, 'setAction(null)', 'await load()', 'toast(successMessage');
});

test('admin users: every moderation action is awaited before its success message (Part 8)', () => {
  for (const call of [
    'suspendAdminUser(',
    'unsuspendAdminUser(',
    'banAdminUser(',
    'unbanAdminUser(',
    'softDeleteAdminUser(',
    'updateAdminUserProfile(',
  ]) {
    assert(userAction.includes(`await ${call}`), `admin users: ${call} is not awaited`);
  }
});

test('admin users: a generated temporary password is never lost to a toast (Part 16)', () => {
  assert(userAction.includes('oneTimeNotice'), 'no one-time notice for temporary passwords');
  assert(userAction.includes('setActionDone(true)'), 'one-time notice cannot stay open for acknowledgement');
});

test('admin staff: action dialog closes on CONFIRMED success, then list refreshes (Parts 9/37)', () => {
  assertMutationContract('admin staff submitStaffAction', staffAction, {
    busyFlag: 'staffBusy',
    setBusy: 'setStaffBusy',
    apiCalls: ['updateStaffProfile(', 'resetStaffPassword(', 'deactivateStaff('],
    closeCalls: ['setStaffAction(null)'],
    errorCall: ['setStaffError('],
  });
  order('admin staff success ordering', staffAction, 'setStaffAction(null)', 'await loadUsers()', 'toast(successMessage');
});

test('admin staff: master-admin protection is untouched (Part 38)', () => {
  assert(
    !staffAction.includes('deleteStaff') && !staffAction.includes('removeStaff'),
    'staff deletion was introduced — master admins must never be deletable',
  );
});

// ---------------------------------------------------------------------------
// PART 10 — PAYMENT ADMIN
// ---------------------------------------------------------------------------
const pmCreate = extractFunction(src.paymentMethods, 'onSubmit');
const pmToggle = extractFunction(src.paymentMethods, 'toggleStatus');
const pmArchive = extractFunction(src.paymentMethods, 'onArchive');

test('payment methods: create/edit closes the modal → refreshes list → toasts (Parts 10/37)', () => {
  assertMutationContract('payment methods onSubmit', pmCreate, {
    busyFlag: 'saving',
    setBusy: 'setSaving',
    apiCalls: ['updateAdminPaymentMethod(', 'createAdminPaymentMethod('],
    closeCalls: ['setFormOpen(false)'],
    errorCall: ['setFormError('],
  });
  order('payment method success ordering', pmCreate, 'setFormOpen(false)', 'await load()', 'toast(');
  assert(!pmCreate.includes('setTimeout'), 'payment method save must not fake a close');
});

test('payment methods: enable/disable refreshes the row state then reports (Part 10)', () => {
  assertMutationContract('payment methods toggleStatus', pmToggle, {
    busyFlag: 'togglingId',
    setBusy: 'setTogglingId',
    enterBusy: 'setTogglingId(m.id)',
    exitBusy: 'setTogglingId(null)',
    apiCalls: ['updateAdminPaymentMethod('],
    closeCalls: [],
    errorCall: ['toast(', 'describeApiError('],
  });
  order('payment method toggle ordering', pmToggle, 'await updateAdminPaymentMethod(', 'await load()', 'toast(');
});

test('payment methods: archive closes the confirm dialog → refreshes → toasts (Parts 10/37)', () => {
  assertMutationContract('payment methods onArchive', pmArchive, {
    busyFlag: 'archiving',
    setBusy: 'setArchiving',
    apiCalls: ['archiveAdminPaymentMethod('],
    closeCalls: ['setArchiveTarget(null)'],
    errorCall: ['toast('],
  });
  order('payment method archive ordering', pmArchive, 'setArchiveTarget(null)', 'await load()', 'toast(');
});

test('payment gateways: save/toggle/archive close → refresh → toast; failure keeps the modal (Part 10)', () => {
  const save = extractFunction(src.paymentGateways, 'handleSave');
  const toggle = extractFunction(src.paymentGateways, 'handleToggle');
  const del = extractFunction(src.paymentGateways, 'handleDelete');

  assertMutationContract('payment gateways handleSave', save, {
    busyFlag: 'saving',
    setBusy: 'setSaving',
    apiCalls: ['updateAdminPaymentGateway(', 'createAdminPaymentGateway('],
    closeCalls: ['setCreateOpen(false)', 'setEditTarget(null)'],
    errorCall: ['toast('],
  });
  order('gateway save ordering', save, 'setCreateOpen(false)', 'await load()', 'toast(wasEdit');

  assertMutationContract('payment gateways handleToggle', toggle, {
    busyFlag: 'busyId',
    setBusy: 'setBusyId',
    enterBusy: 'setBusyId(gw.id)',
    exitBusy: 'setBusyId(null)',
    apiCalls: ['enableAdminPaymentGateway(', 'disableAdminPaymentGateway('],
    closeCalls: [],
    errorCall: ['toast('],
  });
  order('gateway toggle ordering', toggle, 'await load()', 'toast(');

  assertMutationContract('payment gateways handleDelete', del, {
    busyFlag: 'busyId',
    setBusy: 'setBusyId',
    enterBusy: 'setBusyId(deleteTarget.id)',
    exitBusy: 'setBusyId(null)',
    apiCalls: ['archiveAdminPaymentGateway('],
    closeCalls: ['setDeleteTarget(null)'],
    errorCall: ['toast('],
  });
  order('gateway archive ordering', del, 'setDeleteTarget(null)', 'await load()', 'toast(');
});

test('payment gateways: a connection test never closes its dialog on failure (Part 10)', () => {
  const runTest = extractFunction(src.paymentGateways, 'handleTest');
  assert(runTest.includes('setTestTarget(gw)'), 'test dialog is not opened');
  assert(
    !extractCatch(runTest).includes('setTestTarget(null)'),
    'a failed connection test must keep the result visible',
  );
  assert(runTest.includes('setTestResult('), 'the test result is never rendered');
});

test('manual deposits: approve/reject close the detail → refresh → toast (Parts 10/37)', () => {
  const approve = extractFunction(src.manualDeposits, 'approve');
  const reject = extractFunction(src.manualDeposits, 'reject');

  assertMutationContract('manual deposits approve', approve, {
    busyFlag: 'reviewing',
    setBusy: 'setReviewing',
    apiCalls: ['reviewAdminManualDeposit('],
    closeCalls: ['setDetailOpen(false)'],
    errorCall: ['toast('],
  });
  order(
    'manual deposit approve ordering',
    approve,
    'setDetailOpen(false)',
    'await load(statusFilter)',
    'toast(',
  );

  assertMutationContract('manual deposits reject', reject, {
    busyFlag: 'reviewing',
    setBusy: 'setReviewing',
    apiCalls: ['reviewAdminManualDeposit('],
    closeCalls: ['setRejectTarget(null)', 'setDetailOpen(false)'],
    errorCall: ['toast('],
  });
  order(
    'manual deposit reject ordering',
    reject,
    'setRejectTarget(null)',
    'await load(statusFilter)',
    'toast(',
  );
  // The rejection reason is audited — it must survive a failure.
  assert(
    !extractCatch(reject).includes("setRejectReason('')"),
    'a failed rejection must not discard the entered reason',
  );
});

test('manual withdrawals: review/complete close → refresh → toast (Parts 10/34/37)', () => {
  const review = extractFunction(src.manualWithdrawals, 'handleReview');
  const complete = extractFunction(src.manualWithdrawals, 'handleComplete');

  assertMutationContract('manual withdrawals handleReview', review, {
    busyFlag: 'busyId',
    setBusy: 'setBusyId',
    enterBusy: 'setBusyId(w.id)',
    exitBusy: 'setBusyId(null)',
    apiCalls: ['reviewAdminManualWithdrawal('],
    closeCalls: ['setSelected(null)'],
    errorCall: ['toast('],
  });
  order('withdrawal review ordering', review, 'setSelected(null)', 'await load()', 'toast(');

  assertMutationContract('manual withdrawals handleComplete', complete, {
    busyFlag: 'busyId',
    setBusy: 'setBusyId',
    enterBusy: 'setBusyId(selected.id)',
    exitBusy: 'setBusyId(null)',
    apiCalls: ['completeAdminManualWithdrawal('],
    closeCalls: ['setCompleteOpen(false)', 'setSelected(null)'],
    errorCall: ['toast('],
  });
  order('withdrawal complete ordering', complete, 'setCompleteOpen(false)', 'await load()', 'toast(');
  assert(
    !extractCatch(complete).includes("setProviderReference('')"),
    'a failed completion must not discard the provider reference',
  );
});

// ---------------------------------------------------------------------------
// PART 11 — SUPPORT
// ---------------------------------------------------------------------------
test('support chat (customer): a sent message stays IN the chat — no redirect (Part 11)', () => {
  const send = extractFunction(src.chat, 'handleSend');
  assert(!send.includes('router.push') && !send.includes('router.replace'), 'chat must never route');
  assert(send.includes('setSending(true)'), 'chat send has no busy state');
  assert(send.includes('if (!body || sending) return;'), 'chat send has no double-submit guard');
  order('chat send ordering', send, 'await sendSupportMessage(', 'mergeMessage(', 'setSending(false)');
});

test('support chat (customer): the draft is cleared optimistically but restored on failure (Part 11)', () => {
  const send = extractFunction(src.chat, 'handleSend');
  const catchBody = extractCatch(send);
  assert(send.includes("setDraft('')"), 'the draft is never cleared');
  assert(catchBody.includes("status: 'failed'"), 'a failed message is not marked as failed');
  assert(catchBody.includes('setSendError('), 'a failed message surfaces no error');
});

test('support chat (admin): a reply appends to the thread instead of navigating (Part 11)', () => {
  const reply = extractFunction(src.adminSupport, 'handleSendReply');
  assert(!reply.includes('router.push') && !reply.includes('router.replace'), 'admin reply must not route');
  assert(reply.includes('setSending(true)'), 'admin reply has no busy state');
  assert(reply.includes('if (!id || !body || sending) return;'), 'admin reply has no double-submit guard');
  order('admin reply ordering', reply, 'await replyAdminSupportTicket(', "setReply('')");
  assert(extractCatch(reply).includes('toast('), 'a failed admin reply surfaces no error');
});

test('support report (customer): navigate to the NEW case only AFTER success (Parts 4/11)', () => {
  const submit = extractFunction(src.report, 'handleSubmit');
  assert(
    submit.includes('await submitProblemReport('),
    'the report must be awaited before navigating',
  );
  order(
    'report success ordering',
    extractTry(submit),
    'await submitProblemReport(',
    "'Report submitted.",
    'router.push(`/support/reports/${result.ticket.id}`)',
  );
  const catchBody = extractCatch(submit);
  assert(!catchBody.includes('router.push'), 'a failed report must NOT navigate (Part 5)');
  assert(catchBody.includes('setError('), 'a failed report surfaces no error');
});

// ---------------------------------------------------------------------------
// PART 12 — PROFILE / SETTINGS
// ---------------------------------------------------------------------------
test('profile: rehydrates from the server response then closes the editor (Part 12)', () => {
  const submit = extractFunction(src.profile, 'onSubmit');
  order(
    'profile success ordering',
    extractTry(submit),
    'await updateProfile(payload)',
    'setUser(updated)',
    "setFormMessage('Profile updated.')",
    'setEditing(false)',
  );
  assert(submit.includes('if (saving) return;'), 'profile submit has no double-submit guard');
  assert(submit.includes('setSaving(true)'), 'profile submit has no busy state');
});

test('profile: a FAILURE keeps the editor open with every field intact (Parts 5/12)', () => {
  const submit = extractFunction(src.profile, 'onSubmit');
  const catchBody = extractCatch(submit);
  assert(!catchBody.includes('setEditing(false)'), 'a failed profile save must not close the editor');
  assert(!catchBody.includes('setUser('), 'a failed profile save must not mutate the user');
  assert(catchBody.includes('setFormError('), 'a failed profile save surfaces no error');
  assert(!catchBody.includes('setUsername('), 'a failed save must not discard entered values');
});

test('settings: password change clears only the password fields, then revalidates sessions (Part 12)', () => {
  const change = extractFunction(src.settings, 'onChangePassword');
  order(
    'password change success ordering',
    change,
    'await changePassword(currentPassword, newPassword)',
    "setMessage('Password changed.",
    "setCurrentPassword('')",
    'setSessions(await listSessions())',
  );
  const catchBody = extractCatch(change);
  assert(
    !catchBody.includes("setCurrentPassword('')") && !catchBody.includes("setNewPassword('')"),
    'a failed password change must NOT clear the password fields (Part 36)',
  );
  assert(catchBody.includes('setError('), 'a failed password change surfaces no error');
});

test('settings: revoking a session removes it locally and never clears the list on failure (Part 34)', () => {
  const revoke = extractFunction(src.settings, 'onRevoke');
  order('revoke ordering', revoke, 'await revokeSession(sessionId)', 'setSessions((prev) => prev.filter(');
  assert(!extractCatch(revoke).includes('setError(null)'), 'a failed revoke must surface the error');
});

// ---------------------------------------------------------------------------
// DEPOSIT PROOF RULE — "transaction ID OR screenshot", never both
// ---------------------------------------------------------------------------
test('deposit: the two proofs are optional individually and one is always required', () => {
  const validate = extractFunction(src.deposit, 'validateForm');

  // The combined guard: neither field on its own may be mandatory.
  assert(
    /!\s*referenceId\.trim\(\)\s*&&\s*!proofDataUrl/.test(validate),
    'validateForm must reject only when BOTH the transaction ID and the screenshot are empty',
  );
  assert(
    /transaction ID or payment screenshot/i.test(validate),
    'the combined validation message is missing',
  );
  assert(
    /referenceId\.trim\(\)\s*\|\|\s*proofDataUrl/.test(src.deposit),
    'the submit button must unlock on EITHER proof, not on both',
  );

  // Neither input may be marked required to the browser/assistive tech.
  const proofFields = src.deposit.slice(
    at(src.deposit, 'Transaction ID', 'deposit proof fields'),
    at(src.deposit, 'Verification requirement', 'deposit proof fields'),
  );
  assert(
    !/required\s*=\{|^\s*required\s*$/m.test(proofFields),
    'a deposit proof input is still hard-marked `required`',
  );
  assert(
    !src.deposit.includes('aria-required'),
    'a deposit input still declares aria-required',
  );
});

test('deposit: the form states the OR rule instead of implying both are required', () => {
  for (const copy of [
    'Optional if you upload a screenshot',
    'Optional if you provide a transaction ID',
    'Transaction ID OR Payment Screenshot is',
  ]) {
    assert(src.deposit.includes(copy), `the deposit form never says: ${copy}`);
  }
});

test('deposit: the API client refuses an empty submission but sends either proof alone', () => {
  const api = read('lib/api/wallet.ts');
  const submit = extractFunction(api, 'submitManualDeposit');

  assert(
    /!\s*referenceId\s*&&\s*!proofDataUrl/.test(submit),
    'submitManualDeposit must reject only when both proofs are missing',
  );
  assert(
    /referenceId:/.test(submit) && /proofDataUrl:/.test(submit),
    'both proofs must still be forwarded to the API',
  );
  assert(
    /referenceId\?\.trim\(\)\s*\|\|\s*undefined/.test(submit) &&
      /proofDataUrl\?\.trim\(\)\s*\|\|\s*undefined/.test(submit),
    'an absent proof must be omitted rather than sent as an empty string',
  );
});

// ---------------------------------------------------------------------------
// ADMIN — the submitted payment screenshot must be visible
// ---------------------------------------------------------------------------
test('admin manual deposits: the detail view renders the stored payment screenshot', () => {
  const page = src.manualDeposits;

  // The API already returns the proof as `proofPath` — the view must use it.
  assert(
    page.includes('proofPath'),
    'the admin deposit detail never reads deposit.proofPath (the screenshot cannot be shown)',
  );
  assert(
    page.includes('Payment screenshot'),
    'the detail view has no "Payment screenshot" section',
  );
  assert(
    page.includes('No payment screenshot provided.'),
    'a deposit without a screenshot has no explicit empty state',
  );
  // A missing transaction ID is stated, not silently blank.
  assert(
    page.includes('Not provided'),
    'a screenshot-only deposit does not say the transaction ID was not provided',
  );

  // Safety: only the image types the API accepts, rendered as a plain <img>.
  assert(
    /data:image\\\/\(\?:jpeg\|jpg\|png\|webp\|gif\);base64,/.test(page),
    'the screenshot allow-list is no longer the API-accepted image set',
  );
  assert(
    !page.includes('dangerouslySetInnerHTML'),
    'the screenshot must never be injected as HTML',
  );
  assert(
    page.includes('onError'),
    'a broken screenshot image has no error fallback',
  );
  assert(
    page.includes('rel="noopener noreferrer"'),
    'opening the full-size screenshot is not sandboxed',
  );
});

// ---------------------------------------------------------------------------
// PARTS 4 / 42 H+I — NO UNIVERSAL REDIRECT, NO setTimeout HACK
// ---------------------------------------------------------------------------
test('no mutation handler uses a universal `router.push("/dashboard")` redirect (Part 4)', () => {
  const offenders = [];
  for (const [label, source] of Object.entries(src)) {
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      if (line.includes("router.push('/dashboard')") || line.includes('router.push("/dashboard")')) {
        offenders.push(`${label}:${i + 1}`);
      }
    });
  }
  assert(offenders.length === 0, `dashboard redirects found at ${offenders.join(', ')}`);
});

test('no audited mutation handler closes a dialog with setTimeout (Part 42 H)', () => {
  const handlers = {
    deposit: [depositSubmit],
    withdraw: [withdrawSubmit],
    users: [userAction],
    staff: [staffAction],
    paymentMethods: [pmCreate, pmToggle, pmArchive],
  };
  for (const [label, fns] of Object.entries(handlers)) {
    for (const fn of fns) {
      const code = fn
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      assert(!code.includes('setTimeout'), `${label}: setTimeout() found in a mutation handler`);
    }
  }
});

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`form-flow: ${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('form-flow: all tests passed');
