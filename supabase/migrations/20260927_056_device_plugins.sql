-- 056 — Printer Setup and Barcode Scanner, seeded as packages.
--
-- Two capability plugins carved *out* of the core rather than added to it.
--
-- Hardware setup was core: the pairing screens, the ESC/POS test page and the
-- scanner thresholds shipped in every bundle and appeared in every shop's
-- settings menu. Most shops that run this print nothing — the customer reads
-- the total off the screen and walks out — and scan on the defaults, because
-- a wedge scanner is a keyboard and needs no configuration at all. So the
-- screens are now optional packages and the shops that need them switch them
-- on.
--
-- ── What deliberately did NOT move ───────────────────────────────────────
-- Everything a sale depends on stays in the core: the receipt model and its
-- renderer (`shared/receipt`), the four transports (`shared/devices`), and
-- the till's own scan listening. A shop with both plugins off still prints
-- through the browser dialog and still scans. What the plugins add is the
-- *configuration* — and, new here, the invoice design: which template, what
-- the header and footer say, whether the cashier's name is on the paper.
--
-- ── Why neither package ships SQL ────────────────────────────────────────
-- A printer pairing is a browser handle scoped to the profile that made it,
-- and the invoice design belongs to the counter's own device, not to the
-- business: the same shop may have an 80mm till printer and a 58mm handheld.
-- Both therefore store in `localStorage` and own no table, which is why
-- `dataOwnership` is `transient` in the manifests and there is no
-- `plugin_package_sql` here. The packages exist so the Plugins screen can
-- list, price and switch them like every other plugin.
--
-- Free, both of them, permanently: a shop should not pay to describe the
-- hardware it already owns.

insert into public.plugin_packages
      (plugin_key, name, category, version, core_api_version, description,
       dependencies, conflicts)
values
  ('printer-setup', 'Printer Setup', 'optional', '1.0.0', '^1.0.0',
   'Pair a thermal printer over Bluetooth, USB or the network, and design what the printed invoice says.',
   '{}', '{}'),
  ('barcode-scanner', 'Barcode Scanner', 'optional', '1.0.0', '^1.0.0',
   'Tune how this device reads a barcode scanner — speed threshold, prefix, beep — and test it live.',
   '{}', '{}')
on conflict (plugin_key) do update
   set name = excluded.name,
       category = excluded.category,
       version = excluded.version,
       core_api_version = excluded.core_api_version,
       description = excluded.description,
       dependencies = excluded.dependencies,
       conflicts = excluded.conflicts;

-- No permissions of their own. Both screens are gated on `settings.view`,
-- which already answers the question they raise: whoever may configure the
-- shop may configure what the shop prints with. Inventing `printer.manage`
-- would add a key every role has to be taught for no decision it enables.
