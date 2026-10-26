/** 審査員向けのデモアカウント (共有)。画面とサーバーの両方から使う */
export const DEMO_EMAIL = "demo@forkline.invalid";
export const DEMO_NAME = "Forkline Demo";

export function isDemoUser(user: { email: string }) {
  return user.email === DEMO_EMAIL;
}
