document.addEventListener('DOMContentLoaded', async () => {
    const supabaseClient = window.supabaseClient;
    let currentUser = null;
    let currentProfile = {};
    let latestMeasurement = {};

    // ─── Init ─────────────────────────────────────────────────────────────
    async function init() {
        if (!supabaseClient) {
            showToast('Errore di configurazione: ricarica la pagina.', 'error');
            return;
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = '/'; return; }
        currentUser = session.user;

        // Event listeners prima del caricamento dati — così i pulsanti
        // funzionano anche se il profilo non è ancora stato creato nel DB
        setupEventListeners();
        await loadProfile();
    }

    // ─── Load ─────────────────────────────────────────────────────────────
    async function loadProfile() {
        try {
            const [profileRes, measureRes] = await Promise.all([
                supabaseClient
                    .from('profiles')
                    .select('full_name, birthdate, gender, avatar_url, fitness_goals')
                    .eq('id', currentUser.id)
                    .single(),
                supabaseClient
                    .from('body_measurements')
                    .select('height, weight')
                    .eq('user_id', currentUser.id)
                    .order('date', { ascending: false })
                    .limit(1)
            ]);

            currentProfile      = profileRes.data   || {};
            latestMeasurement   = measureRes.data?.[0] || {};
            populateDisplay();
        } catch (err) {
            console.error('Errore caricamento profilo:', err);
        }
    }

    // ─── Display ──────────────────────────────────────────────────────────
    function populateDisplay() {
        const goals = currentProfile.fitness_goals || {};
        const h = latestMeasurement.height;
        const w = latestMeasurement.weight;
        const age = calcAge(currentProfile.birthdate);
        const bmi = (h && w) ? (w / Math.pow(h / 100, 2)).toFixed(1) : null;

        // Hero
        setText('profileDisplayName',   currentProfile.full_name || currentUser.email);
        setText('profileDisplayEmail',  currentUser.email);
        setText('profileDisplayHeight', h ? `${h} cm` : '-- cm');
        setText('profileDisplayWeight', w ? `${w} kg` : '-- kg');
        setText('profileDisplayAge',    age);

        // Stat cards
        setText('statHeight', h ? `${h} cm` : '--');
        setText('statWeight',  w ? `${w} kg` : '--');
        setText('statBMI',    bmi ? bmi : '--');
        setText('statAge',    age);

        // Dati personali
        setText('dataFullName',  currentProfile.full_name);
        setText('dataBirthDate', fmtDate(currentProfile.birthdate));
        setText('dataGender',    capitalize(currentProfile.gender));
        setText('dataHeight',    h ? `${h} cm` : null);
        setText('dataWeight',    w ? `${w} kg` : null);
        setText('dataBMI',       bmi ? `${bmi} — ${bmiLabel(bmi)}` : null);

        // Obiettivi
        setText('dataGoal',         GOAL_LABELS[goals.primary_goal]);
        setText('dataLevel',        capitalize(goals.level));
        setText('dataFrequency',    goals.frequency ? `${goals.frequency} volte/sett.` : null);
        setText('dataDuration',     goals.duration   ? `${goals.duration} min` : null);
        setText('dataTargetWeight', goals.target_weight ? `${goals.target_weight} kg` : null);
        setText('dataEquipment',    EQUIPMENT_LABELS[goals.equipment]);

        // Account
        setText('settingEmail',     currentUser.email);
        setText('settingCreatedAt', fmtDate(currentUser.created_at));

        // Avatar
        if (currentProfile.avatar_url) {
            const av = document.getElementById('profileAvatarDisplay');
            if (av) av.innerHTML = `<img src="${currentProfile.avatar_url}" alt="Avatar"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        }
    }

    // ─── Edit modal ───────────────────────────────────────────────────────
    function openEditModal() {
        const goals = currentProfile.fitness_goals || {};
        const nameParts = (currentProfile.full_name || '').split(' ');

        setValue('editFirstName',    nameParts[0]);
        setValue('editLastName',     nameParts.slice(1).join(' '));
        setValue('editBirthDate',    currentProfile.birthdate);
        setValue('editGender',       currentProfile.gender);
        setValue('editHeight',       latestMeasurement.height);
        setValue('editWeight',       latestMeasurement.weight);
        setValue('editGoal',         goals.primary_goal);
        setValue('editLevel',        goals.level);
        setValue('editFrequency',    goals.frequency);
        setValue('editDuration',     goals.duration);
        setValue('editTargetWeight', goals.target_weight);
        setValue('editEquipment',    goals.equipment);

        openModal('editProfileModal');
    }

    async function saveProfile(e) {
        e.preventDefault();

        const firstName = document.getElementById('editFirstName').value.trim();
        const lastName  = document.getElementById('editLastName').value.trim();
        const fullName  = [firstName, lastName].filter(Boolean).join(' ');
        const height    = parseFloat(document.getElementById('editHeight').value)       || null;
        const weight    = parseFloat(document.getElementById('editWeight').value)       || null;

        const fitness_goals = {
            primary_goal:  document.getElementById('editGoal').value,
            level:         document.getElementById('editLevel').value,
            frequency:     document.getElementById('editFrequency').value,
            duration:      document.getElementById('editDuration').value,
            target_weight: parseFloat(document.getElementById('editTargetWeight').value) || null,
            equipment:     document.getElementById('editEquipment').value,
        };

        const { error: profileErr } = await supabaseClient
            .from('profiles')
            .upsert({
                id:           currentUser.id,
                user_id:      currentUser.id,
                full_name:    fullName,
                birthdate:    document.getElementById('editBirthDate').value || null,
                gender:       document.getElementById('editGender').value,
                fitness_goals,
                updated_at:   new Date().toISOString()
            });

        if (profileErr) {
            showToast('Errore nel salvataggio: ' + profileErr.message, 'error');
            return;
        }

        if (height || weight) {
            await supabaseClient.from('body_measurements').insert({
                user_id: currentUser.id,
                date:    new Date().toISOString().split('T')[0],
                height,
                weight
            });
        }

        closeModal('editProfileModal');
        showToast('Profilo aggiornato con successo!', 'success');
        await loadProfile();
    }

    // ─── Password ─────────────────────────────────────────────────────────
    async function changePassword(e) {
        e.preventDefault();

        const newPass     = document.getElementById('newPassword').value;
        const confirmPass = document.getElementById('confirmPassword').value;
        const errorEl     = document.getElementById('passwordError');

        errorEl.style.display = 'none';

        if (newPass !== confirmPass) {
            errorEl.textContent = 'Le password non corrispondono.';
            errorEl.style.display = 'block';
            return;
        }
        if (newPass.length < 6) {
            errorEl.textContent = 'La password deve avere almeno 6 caratteri.';
            errorEl.style.display = 'block';
            return;
        }

        const { error } = await supabaseClient.auth.updateUser({ password: newPass });
        if (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            return;
        }

        closeModal('changePasswordModal');
        showToast('Password aggiornata con successo!', 'success');
    }

    // ─── Avatar preview ───────────────────────────────────────────────────
    function handleAvatarChange(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const av = document.getElementById('profileAvatarDisplay');
            if (av) av.innerHTML = `<img src="${ev.target.result}" alt="Avatar"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        };
        reader.readAsDataURL(file);
    }

    // ─── Event listeners ──────────────────────────────────────────────────
    function setupEventListeners() {
        document.getElementById('editProfileBtn')?.addEventListener('click', openEditModal);
        document.getElementById('closeEditModal')?.addEventListener('click', () => closeModal('editProfileModal'));
        document.getElementById('cancelEditBtn')?.addEventListener('click', () => closeModal('editProfileModal'));
        document.getElementById('editProfileForm')?.addEventListener('submit', saveProfile);

        document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
            document.getElementById('passwordError').style.display = 'none';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            openModal('changePasswordModal');
        });
        document.getElementById('closePasswordModal')?.addEventListener('click', () => closeModal('changePasswordModal'));
        document.getElementById('cancelPasswordBtn')?.addEventListener('click', () => closeModal('changePasswordModal'));
        document.getElementById('changePasswordForm')?.addEventListener('submit', changePassword);

        document.getElementById('changeEmailBtn')?.addEventListener('click', () => {
            showToast('Per cambiare email contatta il supporto.', 'info');
        });

        document.getElementById('logoutBtn')?.addEventListener('click', async () => {
            await supabaseClient.auth.signOut();
            window.location.href = '/';
        });

        document.getElementById('avatarInput')?.addEventListener('change', handleAvatarChange);

        // Chiudi modal cliccando fuori o con ESC
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal.id); });
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal('editProfileModal');
                closeModal('changePasswordModal');
            }
        });

        if (window.AppCore?.initMobileMenu) window.AppCore.initMobileMenu();
    }

    // ─── Utilities ────────────────────────────────────────────────────────
    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value || '--';
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = (value !== null && value !== undefined) ? value : '';
    }

    function openModal(id) {
        const modal = document.getElementById(id);
        if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
    }

    function calcAge(birthdate) {
        if (!birthdate) return '-- anni';
        const age = Math.floor((Date.now() - new Date(birthdate)) / (365.25 * 24 * 60 * 60 * 1000));
        return `${age} anni`;
    }

    function fmtDate(dateStr) {
        if (!dateStr) return '--';
        return new Date(dateStr).toLocaleDateString('it-IT');
    }

    function capitalize(str) {
        if (!str) return '--';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function bmiLabel(bmi) {
        if (bmi < 18.5) return 'Sottopeso';
        if (bmi < 25)   return 'Normopeso';
        if (bmi < 30)   return 'Sovrappeso';
        return 'Obesità';
    }

    const GOAL_LABELS = {
        perdita_peso:  'Perdita di peso',
        aumento_massa: 'Aumento massa muscolare',
        forza:         'Aumento della forza',
        resistenza:    'Migliorare la resistenza',
        flessibilita:  'Flessibilità e mobilità',
        salute:        'Salute generale',
    };

    const EQUIPMENT_LABELS = {
        nessuna:   'Nessuna (corpo libero)',
        casa_base: 'Casa (attrezzi base)',
        palestra:  'Palestra completa',
    };

    // ─── Start ────────────────────────────────────────────────────────────
    await init();
});
