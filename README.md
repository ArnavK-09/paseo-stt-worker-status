<h1 align="center">🎤 paseo-stt-worker-status 🎤</h1>

<p align="center">
    <img alt="hero" width="450" src="https://emoji-route.vercel.app/svg/🎤" />
</p>

> [!NOTE]
>
> **paseo-stt-worker-status** is a Paseo plugin that shows the live state of Paseo's local speech worker ("Paseo Voice") right in your sidebar footer. If you have ever wondered why that first voice input after opening Paseo took ten seconds, this is the plugin that answers it — the worker loads ~630 MB of Parakeet weights into RAM, and the dot tells you exactly when that load is warm, cooling, or still cold. The same worker backs both dictation and voice mode, so the status covers both.

## 🌟 Features

- **Live status dot** – green **warm**, amber **cooling**, gray **cold**, purple **transcribing** — straight in the sidebar footer
- **Covers every voice surface** – the STT worker serves dictation _and_ voice mode; one letter for both
- **Real process probing** – warm/cold state comes from the actual `Paseo Voice` process (procfs on Linux, `pgrep`/`ps` on macOS), never guessed
- **Transcribe detection** – the worker's accumulated CPU time exposes live Parakeet decoding activity
- **Model inventory** – see which local speech models are present and how big they are (Parakeet v2, Kokoro, Silero VAD)
- **Recent activity timeline** – last worker spawn, last STT start, last finished transcript
- **100% local** – no cloud calls, no accounts, no quota; reads your own host's procfs and daemon log only

## 🚦 Status types

| Dot | State          | Meaning                                            |
| :-: | :------------- | :------------------------------------------------- |
| 🟢  | `warm`         | Worker loaded in RAM — next voice input is instant |
| 🟠  | `cooling`      | Used moments ago; Paseo releases the model shortly |
| 🟣  | `transcribing` | Parakeet is decoding audio right now               |
| ⚪  | `cold`         | No worker running — first use pays the ~10 s load  |

## 💻 Installation

> You can add **paseo-stt-worker-status** to Paseo with one command:

###### terminal

```bash
paseo plugin install github:ArnavK-09/paseo-stt-worker-status
```

> [!IMPORTANT]
> Requires [Paseo](https://paseo.sh) desktop `0.11.4+` on **Linux or macOS** (Paseo's platforms). Live worker probing is kernel-accurate on Linux (`/proc`) and uses `pgrep`/`ps` on macOS.

###### From a local checkout (for development)

```bash
git clone https://github.com/ArnavK-09/paseo-stt-worker-status.git
cd paseo-stt-worker-status
bun install
bun run typecheck
paseo plugin add ./
```

## 📷 Screenshots

> Here are the screenshots of **paseo-stt-worker-status** in action

|                                       Sidebar footer status                                       |
| :-----------------------------------------------------------------------------------------------: |
| ![Footer status](https://github.com/user-attachments/assets/dd252772-a505-41d4-bdf7-9b2730793400) |

|                                        Full detail screen                                         |
| :-----------------------------------------------------------------------------------------------: |
| ![Detail screen](https://github.com/user-attachments/assets/6bd383e0-829d-4f9e-b3ef-ea3024220f9b) |

---

## 💻 Contributing

> [!TIP]
> We welcome contributions to improve **paseo-stt-worker-status**! If you have suggestions, bug fixes, or new feature ideas, follow these steps:

1. **Fork the Repository**
   Click the **Fork** button at the top-right of the repo page.

2. **Clone Your Fork**
   Clone the repo locally:

   ```bash
   git clone https://github.com/ArnavK-09/paseo-stt-worker-status.git
   ```

3. **Create a Branch**
   Create a new branch for your changes:

   ```bash
   git checkout -b your-feature-branch
   ```

4. **Make Changes**
   Implement your changes (bug fixes, features).

5. **Commit and Push**
   Commit your changes and push the branch:

   ```bash
   git commit -m "feat(scope): description"
   git push origin your-feature-branch
   ```

6. **Open a Pull Request**
   Open a PR with a detailed description of your changes.

7. **Collaborate and Merge**
   The maintainers will review your PR, request changes if needed, and merge it once approved.

## 🙋‍♂️ Issues

Found a bug or need help? Please create an issue on the [GitHub repository](https://github.com/ArnavK-09/paseo-stt-worker-status/issues) with a detailed description.

## 👤 Author

<table>
  <tbody>
    <tr>
        <td align="center" valign="top" width="14.28%"><a href="https://github.com/ArnavK-09"><img src="https://github.com/ArnavK-09.png?s=100" width="130px;" alt="Arnav K"/></a><br /><a href="https://github.com/ArnavK-09"<h4><b>Arnav K</b></h3></a></td>
    </tr>
  </tbody>
</table>

---

<p align="center">
    <strong>🌟 If you find this project helpful, please give it a star on GitHub! 🌟</strong>
</p>
