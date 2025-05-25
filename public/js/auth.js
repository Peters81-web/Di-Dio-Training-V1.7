// public/js/auth.js
document.addEventListener('DOMContentLoaded', function() {
    // Inizializzazione Supabase
    const supabaseClient = window.supabaseClient || createSupabaseClient();
        
    // Set up event listeners based on current page
    setupAuthListeners(supabaseClient);
    
    // Check for registration email in localStorage
    const registrationEmail = localStorage.getItem('registrationEmail');
    if (registrationEmail && document.getElementById('loginForm')) {
        showToast(`Ti abbiamo inviato un'email di conferma a ${registrationEmail}. Per favore verifica la tua email per completare la registrazione.`, 'info');
        localStorage.removeItem('registrationEmail');
        
        // Pre-compila l'email se c'è il campo
        const emailInput = document.getElementById('email');
        if (emailInput) emailInput.value = registrationEmail;
    }
    
    // Set up password strength indicators
    setupPasswordValidation();
});

function setupAuthListeners(supabaseClient) {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loading = showLoading();
            
            try {
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });
                
                if (error) {
                    // Gestione specifica per l'errore di email non confermata
                    if (error.message.includes('Email not confirmed')) {
                        showToast(`Per accedere devi prima confermare la tua email. Controlla la tua casella postale ${email} e clicca sul link di conferma.`, 'warning');
                        return;
                    }
                    throw error;
                }
                
                showToast('Accesso effettuato con successo!', 'success');
                
                // Usa un reindirizzamento completo per navigare alla dashboard
                window.location.href = '/dashboard';
            } catch (error) {
                console.error('Errore di login:', error);
                
                // Messaggi di errore personalizzati per casi specifici
                if (error.message.includes('Invalid login credentials')) {
                    showToast('Email o password non validi. Riprova.', 'error');
                } else if (error.message.includes('rate limit')) {
                    showToast('Hai effettuato troppi tentativi. Attendi qualche minuto prima di riprovare.', 'error');
                } else {
                    showToast(error.message, 'error');
                }
            } finally {
                hideLoading(loading);
            }
        });
    }
    
    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Verifica che le password corrispondano prima di procedere
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (password !== confirmPassword) {
                showToast('Le password non corrispondono', 'error');
                return;
            }
            
            const loading = showLoading();
            
            try {
                const username = document.getElementById('username').value;
                const email = document.getElementById('email').value;
                
                // Crea l'utente in auth
                const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            username: username // Salva lo username nei metadati
                        }
                    }
                });
                
                if (authError) throw authError;
                
                // Verifica se abbiamo ricevuto un oggetto utente e procedi di conseguenza
                if (authData && authData.user) {
                    showToast(`Registrazione completata! Per favore controlla la tua casella email ${email} e clicca sul link di conferma per attivare il tuo account.`, 'success');
                    
                    // Memorizza l'email di registrazione
                    localStorage.setItem('registrationEmail', email);
                    
                    // Reindirizza alla pagina di login dopo un breve ritardo
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 5000);
                } else {
                    showToast('Si è verificato un problema durante la registrazione. Riprova più tardi.', 'error');
                }
            } catch (error) {
                console.error('Errore durante la registrazione:', error);
                
                // Messaggi di errore personalizzati per casi specifici
                if (error.message.includes('User already registered')) {
                    showToast('Questa email è già registrata. Utilizza la funzione di recupero password se hai dimenticato la password.', 'error');
                } else if (error.message.includes('rate limit')) {
                    showToast('Hai effettuato troppe richieste. Attendi qualche minuto prima di riprovare.', 'error');
                } else {
                    showToast(error.message, 'error');
                }
            } finally {
                hideLoading(loading);
            }
        });
    }
    
    // Password reset
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('passwordResetModal').style.display = 'block';
        });
    }
    
    const passwordResetForm = document.getElementById('passwordResetForm');
    if (passwordResetForm) {
        passwordResetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loading = showLoading();
            
            try {
                const email = document.getElementById('resetEmail').value;
                const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/reset-password`,
                });
                
                if (error) throw error;
                
                showToast('Email di recupero password inviata con successo!', 'success');
                closeModal('passwordResetModal');
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                hideLoading(loading);
            }
        });
    }
    
    // Logout buttons
    const logoutBtns = document.querySelectorAll('#logoutBtn');
    logoutBtns.forEach(btn => {
        if (btn) {
            btn.addEventListener('click', async () => {
                try {
                    const { error } = await supabaseClient.auth.signOut();
                    if (error) throw error;
                    window.location.href = '/';
                } catch (error) {
                    console.error('Logout error:', error);
                    showToast('Errore durante il logout', 'error');
                }
            });
        }
    });
}

function setupPasswordValidation() {
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    
    if (!passwordInput) return;
    
    // Password strength indicators
    const lengthCheck = document.getElementById('lengthCheck');
    const upperCheck = document.getElementById('upperCheck');
    const lowerCheck = document.getElementById('lowerCheck');
    const numberCheck = document.getElementById('numberCheck');
    const passwordMatchError = document.getElementById('passwordMatchError');
    
    // Check password strength as user types
    passwordInput.addEventListener('input', function() {
        const value = passwordInput.value;
        
        // Check password criteria
        if (lengthCheck) {
            if (value.length >= 8) {
                lengthCheck.classList.add('valid');
            } else {
                lengthCheck.classList.remove('valid');
            }
        }
        
        if (upperCheck) {
            if (/[A-Z]/.test(value)) {
                upperCheck.classList.add('valid');
            } else {
                upperCheck.classList.remove('valid');
            }
        }
        
        if (lowerCheck) {
            if (/[a-z]/.test(value)) {
                lowerCheck.classList.add('valid');
            } else {
                lowerCheck.classList.remove('valid');
            }
        }
        
        if (numberCheck) {
            if (/[0-9]/.test(value)) {
                numberCheck.classList.add('valid');
            } else {
                numberCheck.classList.remove('valid');
            }
        }
        
        // Check password match
        if (confirmPasswordInput && confirmPasswordInput.value !== '') {
            if (confirmPasswordInput.value === value) {
                if (passwordMatchError) passwordMatchError.style.display = 'none';
            } else {
                if (passwordMatchError) passwordMatchError.style.display = 'block';
            }
        }
    });
    
    // Check passwords match
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', function() {
            if (!passwordMatchError) return;
            
            if (confirmPasswordInput.value === passwordInput.value) {
                passwordMatchError.style.display = 'none';
            } else {
                passwordMatchError.style.display = 'block';
            }
        });
    }
}
