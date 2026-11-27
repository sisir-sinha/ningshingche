'use strict';

/**
 * The registration form, as the sources declare it.
 *
 * What the owner asked for, and where each part is checked here:
 *
 *   first name, last name            -> both fields, both required
 *   profile picture via ImgBB        -> picked, uploaded, URL carried into sign-up
 *   email                            -> validated, and refused for throwaway services
 *   password + confirm               -> and a rule that says why it is refused
 *   an eye on each password field    -> so a typo is visible before the account exists
 *   no duplicate account             -> Supabase rejects duplicates on the real signup
 *   straight in after registering    -> the view model saves the session it gets back
 *
 * Source assertions, like the rest of this folder: they cannot prove the app
 * compiles, and they do not replace a build.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(
  __dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');

const FORM = read('ui', 'components', 'RegisterForm.kt');
const WELCOME = read('ui', 'screens', 'WelcomeOnboardingScreen.kt');
const RULES = read('data', 'auth', 'EmailAuth.kt');
const CLIENT = read('data', 'remote', 'SupabaseClient.kt');
const VIEW_MODEL = read('ui', 'viewmodel', 'MainViewModels.kt');

// ----------------------------------------------------------------- the fields ---

test('the form asks for both names', () => {
  assert.match(FORM, /testTag\("register_first_name"\)/, 'no first-name field');
  assert.match(FORM, /testTag\("register_last_name"\)/, 'no last-name field');
  assert.match(FORM, /firstName\.isNotBlank\(\)/, 'the submit does not require a first name');
  assert.match(FORM, /lastName\.isNotBlank\(\)/, 'nor a last name');
});

test('the picture goes through ImgBB and its URL is what sign-up carries', () => {
  assert.match(FORM, /ImgBbUploader\.uploadFromUri\(/, 'the picture is never uploaded');
  assert.match(FORM, /image\.displayUrl/, 'the returned URL is not kept');
  assert.match(FORM, /avatarDeleteUrl/, 'the delete URL is dropped, so the image cannot be cleaned up');
  const signup = VIEW_MODEL.slice(VIEW_MODEL.indexOf('fun signUpWithEmail('));
  assert.match(signup, /avatarUrl = avatarUrl/, 'the picture never reaches the profile');
});

test('the picture is optional, not a gate on creating an account', () => {
  // `canSubmit` must not mention the avatar: refusing an account because somebody
  // did not want to upload a photo closes a door for no reason.
  const submit = FORM.slice(FORM.indexOf('val canSubmit'), FORM.indexOf('Column('));
  assert.ok(!/avatar/i.test(submit), 'the submit button requires a profile picture');
});

// --------------------------------------------------------------- the passwords ---

test('both password fields have an eye, and it really toggles', () => {
  for (const tag of ['register_password', 'register_password_confirm']) {
    assert.ok(FORM.includes(`"${tag}"`), `${tag} is missing`);
  }
  assert.match(FORM, /PasswordVisualTransformation\(\)/, 'the password is never masked');
  assert.match(FORM, /VisualTransformation\.None/, 'the eye cannot reveal it');
  assert.match(FORM, /Icons\.Filled\.VisibilityOff/, 'one eye state is missing its icon');
  assert.match(FORM, /Icons\.Filled\.Visibility\b/, 'the other eye state is missing its icon');
  assert.match(FORM, /"\$\{tag\}_eye"/, 'the eye carries no test tag of its own');
});

test('the two passwords have to match before the button enables', () => {
  assert.match(FORM, /val passwordMatches = password == confirmPassword/);
  assert.match(FORM, /passwordMatches$|passwordMatches\s*$/m);
  assert.match(FORM, /password\.length >= EmailAuthRules\.MIN_PASSWORD/);
  assert.match(FORM, /দুটি পাসওয়ার্ড মিলছে না।/, 'a mismatch is never explained');
});

// ------------------------------------------------------------------ the email ---

test('a throwaway mailbox is refused, and the refusal names a real alternative', () => {
  assert.match(RULES, /class DisposableEmail/, 'there is no disposable-email failure');
  assert.match(RULES, /fun isDisposable/, 'no rule decides what counts as disposable');
  assert.match(RULES, /DISPOSABLE_DOMAINS/, 'no list of throwaway services');
  for (const domain of ['mailinator.com', 'yopmail.com', 'tempmail.com', 'guerrillamail.com']) {
    assert.ok(RULES.includes(`"${domain}"`), `${domain} is not on the blocklist`);
  }
  assert.match(RULES, /endsWith\("\.\$blocked"\)/, 'a subdomain would slip past the list');
  assert.match(RULES, /is EmailAuthException\.DisposableEmail ->/, 'the failure has no sentence');
});

test('the form says so while the address is being typed, not after submitting', () => {
  assert.match(FORM, /EmailAuthRules\.isDisposable\(email\)/, 'the form never checks the domain');
  assert.match(FORM, /emailProblem == null/, 'the submit does not wait for a valid address');
  assert.match(FORM, /isError = emailProblem != null/, 'the field does not turn red');
});

test('duplicate accounts are rejected by the real signup, not an extra signup probe', () => {
  assert.match(RULES, /class AlreadyRegistered/);
  assert.match(CLIENT, /user_already_exists/);
  assert.match(CLIENT, /EmailAuthException\.AlreadyRegistered\(\)/);
  assert.doesNotMatch(CLIENT, /suspend fun isEmailRegistered/);
  const signup = VIEW_MODEL.slice(VIEW_MODEL.indexOf('fun signUpWithEmail('), VIEW_MODEL.indexOf('fun sendResetCode('));
  assert.doesNotMatch(signup, /isEmailRegistered/);
  assert.match(signup, /\.signUpWithEmail\(/);
});

// --------------------------------------------------------------- after sign-up ---

test('registering signs the reader straight in', () => {
  // The session is what `signUpWithEmail` returns when the project does not
  // require a confirmation; the view model saving it is what makes the reader
  // arrive signed in, with no second form to fill.
  assert.match(CLIENT, /postAuthForSession\("\$\{SupabaseConfig\.authBaseUrl}\/signup"/,
    'sign-up does not go through the session-returning path');
  assert.match(VIEW_MODEL, /supabaseClient\s*\.signUpWithEmail\(/);
  assert.match(WELCOME, /onRegister = \{/, 'the onboarding step passes no register handler');
});

test('the name and picture travel with the sign-up, not after it', () => {
  assert.match(CLIENT, /put\("data", JSONObject\(\)/, 'no user metadata is sent');
  for (const key of ['full_name', 'given_name', 'family_name', 'avatar_url']) {
    assert.ok(CLIENT.includes(`"${key}"`), `${key} is not in the sign-up metadata`);
  }
});

test('the first-run step offers registration beside Google and skip', () => {
  assert.match(WELCOME, /RegisterForm\(/, 'the form is not on the first-run screen');
  assert.match(WELCOME, /welcome_register_button/, 'no way to reach it');
  assert.match(WELCOME, /GoogleSignInButton\(/, 'Google was removed');
  assert.match(WELCOME, /welcome_login_skip_button/, 'skip was removed');
  assert.match(WELCOME, /currentUser != null && !passwordResetActive && !emailInProgress && !inProgress && registrationWarning == null/,
    'the recovery guard was lost from this screen');
});


test('photo upload cannot cancel itself or restore a spinner without a job', () => {
  const helper = read('ui', 'components', 'RegistrationPhotoUpload.kt');
  assert.doesNotMatch(FORM, /LaunchedEffect\(pendingUpload\)|pendingUpload/);
  assert.match(FORM, /uploading by remember \{ mutableStateOf\(false\) \}/);
  assert.match(FORM, /uploadScope\.launch/);
  assert.match(FORM, /onFinish = \{ uploading = false \}/);
  assert.match(helper, /finally \{\s*onFinish\(\)/);
  assert.match(helper, /catch \(cancelled: CancellationException\) \{\s*throw cancelled/);
});

test('optional phone and address reach the profile without becoming signup requirements', () => {
  const login = read('ui', 'screens', 'LoginScreen.kt');
  for (const tag of ['register_phone', 'register_address']) assert.ok(FORM.includes(`"${tag}"`));
  const submit = FORM.slice(FORM.indexOf('val canSubmit'), FORM.indexOf('Column('));
  assert.doesNotMatch(submit, /phone|address/);
  for (const screen of [login, WELCOME]) {
    assert.match(screen, /phone = phone/); assert.match(screen, /address = address/);
    assert.match(screen, /!emailInProgress && !inProgress && registrationWarning == null/);
    assert.match(screen, /RegistrationProfileWarning\(/);
  }
  assert.match(VIEW_MODEL, /phone = phone\.trim\(\)/);
  assert.match(VIEW_MODEL, /address = address\.trim\(\)/);
  assert.match(VIEW_MODEL, /upsertReaderProfile\(completed\)\.onFailure/);
  assert.match(CLIENT, /if \(!response\.isSuccessful\) throw IOException\("Profile save failed/);
  assert.match(CLIENT, /if \(rows\.length\(\) == 0\) throw IOException/);
  assert.doesNotMatch(RULES, /"tutanota\.de"|"protonmail\.ch"/);
});
