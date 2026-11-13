"""Service clients forward caller cookies explicitly and never retain another caller's jar."""

from http.cookiejar import Cookie, CookieJar, DefaultCookiePolicy
from urllib.request import Request


class RejectCookies(DefaultCookiePolicy):
    def set_ok(self, cookie: Cookie, request: Request) -> bool:
        return False


def stateless_cookies() -> CookieJar:
    return CookieJar(policy=RejectCookies())
