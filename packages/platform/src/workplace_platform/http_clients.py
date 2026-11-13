"""Service clients forward caller cookies explicitly and never retain another caller's jar."""

from http.cookiejar import CookieJar, DefaultCookiePolicy


class RejectCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False


def stateless_cookies() -> CookieJar:
    return CookieJar(policy=RejectCookies())
