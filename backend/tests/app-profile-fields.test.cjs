'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('profile editor puts required identity after email and marks Facebook optional', () => {
  const form = read('app/src/main/java/com/ningshingche/app/ui/screens/UserProfileScreen.kt');
  assert.ok(form.indexOf('value = signedIn.email') < form.indexOf('value = designation'));
  assert.ok(form.indexOf('value = designation') < form.indexOf('value = about'));
  assert.match(form, /পদবি \/ পরিচয় \(আবশ্যক\)/);
  assert.match(form, /Facebook আইডি \/ লিংক \(ঐচ্ছিক\)/);
  const vm = read('app/src/main/java/com/ningshingche/app/ui/viewmodel/ReaderWorkspaceViewModel.kt');
  const section = vm.slice(vm.indexOf('fun saveProfile('), vm.indexOf('fun uploadAvatar('));
  assert.match(section, /updated\.designation\.isBlank\(\)/);
  assert.doesNotMatch(section, /updated\.facebookId\.isBlank\(\)/);
});

test('dashboard home uses the same translated ঘর key as app navigation', () => {
  const dashboard = read('app/src/main/java/com/ningshingche/app/ui/screens/UserDashboardScreen.kt');
  assert.match(dashboard, /label\s*=\s*\{\s*Text\(t\("ঘর"\)/);
  const bn = read('backend/assets/lang/bn.csv');
  const en = read('app/src/main/assets/i18n/en.csv');
  const bpy = read('app/src/main/assets/i18n/bpy.csv');
  assert.match(bn, /^ঘর,ঘর$/m);
  assert.match(en, /^ঘর,Home$/m);
  assert.match(bpy, /^ঘর,ঘর$/m);
  assert.match(en, /^পদবি \/ পরিচয় \(আবশ্যক\),Title \/ identity \(required\)$/m);
  assert.match(en, /^Facebook আইডি \/ লিংক \(ঐচ্ছিক\),Facebook ID \/ link \(optional\)$/m);
});
