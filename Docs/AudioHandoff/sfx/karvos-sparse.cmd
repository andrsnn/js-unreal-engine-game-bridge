@echo off
del "C:\Users\Aidan Anderson\karvos\.git\worktrees\karvos\index.lock"
del "C:\Users\Aidan Anderson\karvos\.git\worktrees\karvos\locked"
cd /d G:\sfx\karvos
git config --local --unset core.sparseCheckout
git config --local --unset core.sparseCheckoutCone
git config extensions.worktreeConfig true
git config --worktree core.sparseCheckout true
git config --worktree core.sparseCheckoutCone false
git read-tree -mu HEAD
