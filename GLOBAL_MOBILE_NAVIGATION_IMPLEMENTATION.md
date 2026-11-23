# Global Mobile Navigation — Implementation & Hydration Fix

**Date:** 2026-11-23  
**Scope:** TANVIONROYALE — Hydration Resolution & Mobile Navigation Controller

---

## 1. Hydration Fix (Root Cause Resolved)

### Issue
```
Warning: Did not expect server HTML to contain a <div> in <div>.
    at div
    at div
    at aside
    at UserSidebar
    at Suspense
    at HideOnGamePlay
```
On initial server render (SSR), `StudioSidebarNav` rendered skeleton placeholder divs (`<div className="pt-2" data-testid="sidebar-studios">`). However, on the client, when provider count was zero or cached as empty, `StudioSidebarNav` immediately returned `null`. This mismatch aborted React hydration upon fresh reload.

### Solution
In [`apps/web/components/navigation/studio-sidebar-nav.tsx`](file:///D:/tanvionroyale/apps/web/components/navigation/studio-sidebar-nav.tsx):
- Added `mounted` state via `useEffect`.
- During SSR and initial hydration (`!mounted`), renders the exact skeleton markup on both server and client.
- Once mounted, updates dynamically based on loaded providers.
- Hydration mismatch is completely eliminated.

---

## 2. Responsive Navigation Specification (< 768px)

### 1. Initial Load & Route Changes
- Both Top Menu and Bottom Menu are **VISIBLE**.

### 2. Normal Continuous Scrolling (Any Direction)
- Normal continuous scrolling in either direction immediately **HIDES BOTH MENUS** (`top: false, bottom: false`).

### 3. Scroll Stops
- When scrolling stops, **menus do NOT automatically appear**. Both remain hidden if previously hidden.

### 4. Post-Scroll Small Movement ("Halka Scroll")
- **Upper content comes into display (scroll up / pull down):**
  - **Top Menu SHOWS**.
  - **Bottom Menu does NOT hide** if already visible.
- **Lower content comes into display (scroll down / push up):**
  - **Bottom Menu SHOWS**.
  - **Top Menu does NOT hide** if already visible.

### 5. Independent Visibility
- Showing Top Menu never hides Bottom Menu.
- Showing Bottom Menu never hides Top Menu.
- **Only normal continuous scrolling hides both menus.**

### 6. Desktop (>= 768px)
- Top Menu always visible (`md:translate-y-0`).
- Bottom Menu always hidden via `md:hidden` CSS.
