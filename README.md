<h1 align="center">🎤 paseo-stt-worker-status 🎤</h1>
<h2 align="center">A live status light for Paseo's local STT worker — warm, cold, transcribing</h2>

<p align="center">
    <img alt="hero" width="450" src="https://emoji-route.vercel.app/svg/🎤" />
</p>

> [!NOTE]
>
> **paseo-stt-worker-status** is a Paseo plugin that shows the live state of Paseo's local speech worker ("Paseo Voice") right in your sidebar footer. If you have ever wondered why that first voice input after opening Paseo took ten seconds, this is the plugin that answers it — the worker loads ~630 MB of Parakeet weights into RAM, and the dot tells you exactly when that load is warm, cooling, or still cold. The same worker backs both dictation and voice mode, so the status covers both.

## 🌟 Features

- **Live status dot** – green **warm**, amber **cooling**, gray **cold**, purple **transcribing** — straight in the sidebar footer
- **Covers every voice surface** – the STT worker serves dictation _and_ voice mode; one letter for both
- **Real process probing** – warm/cold state comes from the actual `Paseo Voice` process via `/proc`, never guessed
- **Transcribe detection** – Linux CPU accounting ticks of the worker expose live Parakeet decoding activity
- **Model inventory** – see which local speech models are present and how big they are (Parakeet v2, Kokoro, Silero VAD)
- **Recent activity timeline** – last worker spawn, last STT start, last finished transcript
- **100% local** – no cloud calls, no accounts, no quota; reads your own host's procfs and daemon log only

## 💻 Installation

> You can add **paseo-stt-worker-status** to Paseo with one command:

###### terminal

```bash
paseo plugin install github:ArnavK-09/paseo-stt-worker-status
```

> Paseo clones the repository, prepares it, and compiles it on your daemon host — no package manager or dependency install is needed by the consumer.

> [!IMPORTANT]
> Requires [Paseo](https://paseo.sh) desktop `0.11.4+`. Status probing is Linux-based (`/proc`); a worker running on Linux shows full accuracy right now.

###### From a local checkout (for development)

```bash
git clone https://github.com/ArnavK-09/paseo-stt-worker-status.git
cd paseo-stt-worker-status
bun install
bun run typecheck
paseo plugin add ./
```

> Development tooling uses [bun](https://bun.sh) — `bun install` restores dependencies, `bun run typecheck`, `bun run lint`, and `bun run format` keep the codebase checked. Consumers of the published plugin never install dependencies: Paseo compiles it on the daemon host.

## 📷 Screenshots

> Here are the screenshots of **paseo-stt-worker-status** in action

| Sidebar footer status                         | Full detail screen                            |
| --------------------------------------------- | --------------------------------------------- |
| ![Footer status](docs/screenshots/footer.png) | ![Detail screen](docs/screenshots/detail.png) |

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

## 🛣️ Roadmap

|                  Task                  | Status |
| :------------------------------------: | :----: |
|      🟢 Worker warm / cold states      |   🟢   |
|     🟢 Live transcribing detection     |   🟢   |
| 🟢 Model inventory + activity timeline |   🟢   |
|            🟡 macOS support            |   🟡   |
|           🔴 Windows support           |   🔴   |

---

<h2 align="center">📄 License</h2>

<p align="center">
<strong>paseo-stt-worker-status</strong> is licensed under the <code>Unlicense</code> License. See the <a href="https://github.com/ArnavK-09/paseo-stt-worker-status/blob/main/LICENSE">LICENSE</a> file for more details.
</p>

---

<!-- <h3 align="center">💖 Thanks for Using paseo-stt-worker-status 💖</h3> -->

<p align="center">
    <strong>🌟 If you find this project helpful, please give it a star on GitHub! 🌟</strong>
</p>
