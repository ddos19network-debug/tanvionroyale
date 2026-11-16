const fs = require('fs');
const p = 'D:/tanvionroyale/apps/web/app/(user)/assets/page.tsx';
let c = fs.readFileSync(p, 'utf-8');

// Remove the last </section> and any trailing whitespace
c = c.replace(/\s*<\/section>\s*$/, '');

const add = `

        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Quick Actions</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-3 text-indigo-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20m0-20h20" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Deposit</h3>
              <p className="text-xs text-slate-500">Add funds to your wallet</p>
              <Link href="/trading/deposit" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Deposit Funds &rarr;
              </Link>
            </Card>
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3 text-emerald-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="12 22 8 10 4 16" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Withdraw</h3>
              <p className="text-xs text-slate-500">Request a payout</p>
              <Link href="/wallet" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Withdraw Funds &rarr;
              </Link>
            </Card>
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-3 text-amber-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Trading</h3>
              <p className="text-xs text-slate-500">Open trading terminal</p>
              <Link href="/trading" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Start Trading &rarr;
              </Link>
            </Card>
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3 text-purple-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="10" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Wallet</h3>
              <p className="text-xs text-slate-500">Manage wallet settings</p>
              <Link href="/wallet" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Manage Wallet &rarr;
              </Link>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}`;

c = c.trim() + add;
fs.writeFileSync(p, c, 'utf-8');
console.log('SUCCESS - Appended Quick Actions and closing tags');