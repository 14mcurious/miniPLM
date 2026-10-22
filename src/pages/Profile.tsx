import { useEffect, useState } from "react";
import BackLink from "@/components/BackLink";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import ChangeEmailSection from "@/pages/profile/ChangeEmailSection";
import ChangeNameSection from "@/pages/profile/ChangeNameSection";
import ChangePasswordSection from "@/pages/profile/ChangePasswordSection";
import { fetchProfile, type ProfileUser } from "@/lib/profile";

const labelClass = "block text-sm font-medium leading-none text-foreground mb-1";

/**
 * The user's own profile: read-only data plus the three OTP-confirmed
 * changes (email, password, name/surname).
 */
const Profile = () => {
  const { t } = useI18n();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile()
      .then(setUser)
      .catch(() => toast.error(t("error.requestFailed", { status: "?" })))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <BackLink to="/" label={t("home.title")} />
      <div className="flex min-h-screen justify-center bg-background p-4 pt-14">
        <div className="w-full max-w-2xl space-y-6">
          <div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
              {t("profile.title")}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("profile.description")}
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("usersList.loading")}
            </p>
          ) : user ? (
            <>
              <dl className="space-y-3 rounded-md border p-4 text-sm">
                <div>
                  <dt className={labelClass}>{t("profile.loginNameLabel")}</dt>
                  <dd className="text-foreground">{user.loginName}</dd>
                </div>
                <div>
                  <dt className={labelClass}>{t("profile.emailLabel")}</dt>
                  <dd className="text-foreground">{user.email}</dd>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className={labelClass}>{t("profile.nameLabel")}</dt>
                    <dd className="text-foreground">{user.name}</dd>
                  </div>
                  <div>
                    <dt className={labelClass}>{t("profile.surnameLabel")}</dt>
                    <dd className="text-foreground">{user.surname}</dd>
                  </div>
                </div>
                <div>
                  <dt className={labelClass}>{t("newUser.company")}</dt>
                  <dd className="text-foreground">
                    {user.company || t("usersList.none")}
                  </dd>
                </div>
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  {t("profile.loginNameNote")}
                </p>
              </dl>

              <ChangeEmailSection user={user} onUpdated={setUser} />
              <ChangePasswordSection user={user} onUpdated={setUser} />
              <ChangeNameSection user={user} onUpdated={setUser} />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default Profile;
