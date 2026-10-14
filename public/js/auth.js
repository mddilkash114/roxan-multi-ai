function setAuthMessage(text, isError = false) {
    if (!authMessage) {
        return;
    }

    authMessage.textContent = text || "";
    authMessage.className = isError ? "error-text" : "";
}

function toggleAuthMode() {
    isRegister = !isRegister;

    if (authName) {
        authName.style.display = isRegister ? "block" : "none";
        authName.required = isRegister;
        authName.hidden = !isRegister;
    }

    if (authSubmit) {
        authSubmit.textContent = isRegister ? "Create Account" : "Sign In";
    }

    if (authMode) {
        authMode.textContent = isRegister
            ? "Already have an account? Sign In"
            : "Create an account";
    }

    setAuthMessage(
        isRegister
            ? "Create your account to get started."
            : "Welcome back! Sign in to continue."
    );
}

async function handleAuthSubmit(event) {
    event.preventDefault();

    const name = authName?.value.trim() || "";
    const email = authEmail?.value.trim() || "";
    const password = authPassword?.value.trim() || "";

    if (isRegister && !name) {
        setAuthMessage("Please enter your name.", true);
        authName?.focus();
        return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
        setAuthMessage("Please enter a valid email.", true);
        authEmail?.focus();
        return;
    }

    if (password.length < 8) {
        setAuthMessage("Password must be at least 8 characters.", true);
        authPassword?.focus();
        return;
    }

    const endpoint = isRegister ? "register" : "login";
    const payload = { email, password };

    if (isRegister) {
        payload.name = name;
    }

    authSubmit.disabled = true;
    authSubmit.classList.add("loading");
    authSubmit.textContent = isRegister ? "Creating Account" : "Signing In";
    authMessage.textContent = isRegister
        ? "Creating your account..."
        : "Signing you in...";
    authMessage.className = "";

    try {
        const response = await api(`/api/auth/${endpoint}`, {
            method: "POST",
            body: JSON.stringify(payload)
        });

        if (isRegister && response?.verificationRequired) {
            authForm.reset();

            authName.style.display = "none";
            authName.hidden = true;
            authName.required = false;

            isRegister = false;

            authSubmit.disabled = false;
            authSubmit.classList.remove("loading");
            authSubmit.textContent = "Sign In";

            authMode.textContent = "Create an account";

            setAuthMessage(
                "✅ Account created! Please check your email and click the verification link to activate your account.",
                false
            );

            return;
        }

        if (!response?.token) {
            throw new Error("Authentication token was not returned.");
        }

        if (isRegister) {
            authMessage.textContent = "Account created successfully.";
            authMessage.className = "success-text";
        }

        localStorage.setItem("roxanToken", response.token);

        await startApp();

    } catch (error) {
        authSubmit.disabled = false;
        authSubmit.classList.remove("loading");
        authSubmit.textContent = isRegister ? "Create Account" : "Sign In";

        authMessage.textContent =
            error.message ||
            (isRegister ? "Account creation failed." : "Sign in failed.");

        authMessage.className = "error-text";
    }
}

function handleLogout() {
    localStorage.removeItem("roxanToken");

    if (typeof disconnectSocket === "function") {
        disconnectSocket();
    }

    location.reload();
}

async function loadUserInfo() {
    try {
        const response = await api("/api/auth/me");

        if (!response?.user) {
            return;
        }

        const nameEl = document.getElementById("userName");
        const avatarEl = document.getElementById("userAvatar");
        const dropdownEmailEl = document.getElementById("dropdownEmail");

        const name = response.user.name || "User";
        const email = response.user.email || "";

        if (nameEl) {
            nameEl.textContent = name;
        }

        if (avatarEl) {
            avatarEl.textContent = name.charAt(0).toUpperCase();
        }

        if (dropdownEmailEl) {
            dropdownEmailEl.textContent = email;
        }
    } catch (error) {
        console.error("Load user info error:", error);
    }
}

async function checkAuthStatus() {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify");

    if (verifyToken) {
        showAuth();
        setAuthMessage("Verifying your email...", false);

        try {
            const response = await api("/api/auth/verify-email", {
                method: "POST",
                body: JSON.stringify({ token: verifyToken })
            });

            if (response?.token) {
                localStorage.setItem("roxanToken", response.token);
                window.history.replaceState({}, "", "/");
                setAuthMessage("✅ Email verified! Signing you in...", false);

                setTimeout(async () => {
                    await startApp();
                }, 600);

                return;
            }

            setAuthMessage("Verification failed. Please try again.", true);
        } catch (error) {
            setAuthMessage(error.message || "Verification failed.", true);
        }

        return;
    }

    const token = localStorage.getItem("roxanToken");

    try {
        if (!token) {
            showAuth();
            return;
        }

        const response = await api("/api/auth/me");

        if (response?.user) {
            await startApp();
            return;
        }

        showAuth();
    } catch {
        showAuth();
    }
}

window.setAuthMessage = setAuthMessage;
window.toggleAuthMode = toggleAuthMode;
window.handleAuthSubmit = handleAuthSubmit;
window.handleLogout = handleLogout;
window.loadUserInfo = loadUserInfo;
window.checkAuthStatus = checkAuthStatus;