export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

export type ApiEnv = {
  Bindings: AppEnv;
  Variables: {
    user: SessionUser;
  };
};
