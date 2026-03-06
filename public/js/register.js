const username = document.querySelector("#registerUsername");
const password = document.querySelector("#registerPassword");
const checkPassword = document.querySelector("#registerCheckPassword");
const registerBtn = document.querySelector("#registerBtn");
const registerWarning = document.querySelector("#registerWarning");

if (registerBtn && username && password && checkPassword && registerWarning) {
    registerBtn.addEventListener("click", verifyAndRegister);
}

function verifyAndRegister(event) {
    const hasBlankFields =
        username.value.trim() === "" ||
        password.value.trim() === "" ||
        checkPassword.value.trim() === "";

    if (hasBlankFields) {
        registerWarning.innerText = "Please fill in all fields.";
        registerWarning.style.color = "#ff7676";
        event.preventDefault();
        return;
    }

    if (password.value !== checkPassword.value) {
        registerWarning.innerText = "Passwords do not match.";
        registerWarning.style.color = "#ff7676";
        event.preventDefault();
        return;
    }

    if (password.value.length < 8) {
        registerWarning.innerText = "Password must be at least 8 characters.";
        registerWarning.style.color = "#ff7676";
        event.preventDefault();
        return;
    }

    registerWarning.innerText = "";
}